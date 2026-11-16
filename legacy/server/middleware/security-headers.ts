import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { env, isHttps } from '../env'

/**
 * Security headers per surface (docs/research/06-security-quality.md B1):
 *
 * - api:       `default-src 'none'`, never framed.
 * - dashboard: the app shell (dashboard, auth, front page). Strict CSP, never framed.
 * - form:      /f/* and /embed.js. Framable by any site, Turnstile allowed.
 *
 * A header a route already set is kept (e.g. CORP on uploaded files).
 */
export type Surface = 'api' | 'dashboard' | 'form'

const TURNSTILE = 'https://challenges.cloudflare.com'

/** CDN origin for uploaded images (img-src), from BUNNY_CDN_URL. */
function cdnOrigin(): string | null {
  try {
    return env.BUNNY_CDN_URL ? new URL(env.BUNNY_CDN_URL).origin : null
  } catch {
    return null
  }
}

/** sha256 CSP sources for every inline <script> (no src) in an HTML document. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  for (const m of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!m[1].trim()) continue
    hashes.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`)
  }
  return hashes
}

export function contentSecurityPolicy(surface: Surface, scriptHashes: string[] = []): string {
  if (surface === 'api') return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  const cdn = cdnOrigin()
  const form = surface === 'form'
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...scriptHashes, ...(form ? [TURNSTILE] : [])]],
    // Radix, Sonner and theme variables set inline styles. Every font is self-hosted (Fontsource
    // files bundled into /assets), so no font origin is allowed: respondents' IPs never reach a font CDN.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...(cdn ? [cdn] : [])]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...(form ? [TURNSTILE] : [])]],
    ['frame-src', ["'self'", ...(form ? [TURNSTILE] : [])]],
    ['worker-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', [form ? '*' : "'none'"]],
  ]
  const csp = directives.map(([k, v]) => `${k} ${v.join(' ')}`)
  if (isHttps) csp.push('upgrade-insecure-requests')
  return csp.join('; ')
}

export function securityHeaders(surface: Surface, scriptHashes: string[] = []): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(surface, scriptHashes),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Origin-Agent-Cluster': '?1',
  }
  if (surface !== 'form') {
    headers['X-Frame-Options'] = 'DENY'
    headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    headers['Cross-Origin-Resource-Policy'] = 'same-origin'
  } else {
    // Embedded in other sites; embed.js is loaded by them as a script.
    headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
  }
  if (isHttps) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  return headers
}

/** Middleware: sets the surface's headers after the handler, keeping any the handler set. */
export function surfaceHeaders(surface: Surface | ((path: string) => Surface), scriptHashes: string[] | ((path: string) => string[]) = []): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const s = typeof surface === 'function' ? surface(c.req.path) : surface
    const hashes = typeof scriptHashes === 'function' ? scriptHashes(c.req.path) : scriptHashes
    for (const [k, v] of Object.entries(securityHeaders(s, hashes))) {
      if (!c.res.headers.has(k)) c.res.headers.set(k, v)
    }
  }
}

/** Which surface a non-API path belongs to. */
export function surfaceFor(path: string): Surface {
  if (path.startsWith('/api/')) return 'api'
  if (path === '/f' || path.startsWith('/f/') || path === '/embed.js') return 'form'
  return 'dashboard'
}

import Bowser from 'bowser'
import type { Context } from 'hono'
import { env } from '../env'
import { hashIp } from './crypto'
import { clientIp } from './ip'

export type Device = 'desktop' | 'mobile' | 'tablet'

export interface RequestMeta {
  /** Salted HMAC of the client IP (HKDF subkey of APP_SECRET); null when unknown. Never the raw IP. */
  ipHash: string | null
  /** ISO 3166-1 alpha-2 from a trusted proxy header, or null. */
  country: string | null
  device: Device | null
  browser: string | null
}

/**
 * Respondent metadata stored with a response (PRD privacy: hashed IP, country at submit time).
 * Country is read from COUNTRY_HEADER (or CF-IPCountry when a trusted proxy is configured);
 * without a trusted proxy the header is client-controlled, so it's ignored.
 */
export function requestMeta(c: Context): RequestMeta {
  const ip = clientIp(c)
  return {
    ipHash: ip ? hashIp(ip) : null,
    country: countryOf(c),
    ...deviceOf(c.req.header('user-agent') ?? '', {
      mobile: c.req.header('sec-ch-ua-mobile'),
      brands: c.req.header('sec-ch-ua'),
    }),
  }
}

function countryOf(c: Context): string | null {
  const header = env.COUNTRY_HEADER ?? (env.TRUSTED_PROXY_HOPS > 0 ? 'cf-ipcountry' : undefined)
  if (!header) return null
  const v = c.req.header(header)?.trim().toUpperCase()
  // XX = unknown, T1 = Tor (Cloudflare).
  return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null
}

const BRAND_NAMES: Record<string, string> = {
  'google chrome': 'Chrome',
  'microsoft edge': 'Edge',
  opera: 'Opera',
  brave: 'Brave',
  'yandex': 'Yandex',
  'samsung internet': 'Samsung Internet',
}

/** Device type and browser name from the User-Agent, refined by client hints when sent. */
export function deviceOf(ua: string, hints: { mobile?: string; brands?: string } = {}): { device: Device | null; browser: string | null } {
  const parsed = ua ? Bowser.parse(ua) : null
  const type = parsed?.platform.type
  let device: Device | null = type === 'mobile' ? 'mobile' : type === 'tablet' ? 'tablet' : type === 'desktop' ? 'desktop' : null
  if (hints.mobile === '?1') device = 'mobile'
  else if (hints.mobile === '?0' && device === null) device = 'desktop'

  let browser = parsed?.browser.name ?? null
  if (hints.brands) {
    // Sec-CH-UA: "Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"
    const brands = [...hints.brands.matchAll(/"([^"]+)"\s*;\s*v="[^"]*"/g)].map((m) => m[1])
    const named = brands.map((b) => BRAND_NAMES[b.toLowerCase()]).find(Boolean)
    if (named) browser = named
  }
  if (browser === 'Microsoft Edge') browser = 'Edge'
  return { device, browser: browser ? browser.slice(0, 40) : null }
}

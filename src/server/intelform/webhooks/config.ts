/**
 * A form's webhook settings (forms.settings.webhook), read leniently: older rows, a missing
 * key or a bad header never break a delivery. Shape (src/lib/intelform/form/settings.ts):
 *   { enabled: boolean, url: string | null, headers: {key, value}[] }
 * A header map (`{name: value}`) from older rows is accepted too.
 */
export interface WebhookConfig {
  enabled: boolean
  url: string | null
  headers: [string, string][]
}

/** Headers the sender owns: a custom header can't replace them. */
const RESERVED = /^(host|content-length|content-type|transfer-encoding|connection|user-agent|cookie|webhook-.*|cf-.*|x-forwarded-.*)$/i
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function readWebhookConfig(settings: unknown): WebhookConfig {
  const w = ((settings as { webhook?: Record<string, unknown> } | null)?.webhook ?? {}) as Record<string, unknown>
  const url = typeof w.url === 'string' && w.url.trim() ? w.url.trim() : null
  const raw = w.headers
  const headers: [string, string][] = []
  if (Array.isArray(raw)) {
    for (const h of raw as Record<string, unknown>[]) {
      const k = String(h?.key ?? h?.name ?? '').trim()
      if (k) headers.push([k, String(h?.value ?? '')])
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (k.trim()) headers.push([k.trim(), String(v ?? '')])
  }
  return {
    enabled: w.enabled !== false && !!url,
    url,
    headers: headers
      .filter(([k, v]) => k.length <= 100 && TOKEN.test(k) && !RESERVED.test(k) && v.length <= 1000 && !/[\r\n\0]/.test(v))
      .slice(0, 20),
  }
}

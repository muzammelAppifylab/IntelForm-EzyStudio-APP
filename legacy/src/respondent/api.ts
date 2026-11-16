import type { ApiErrorBody } from '@shared/api'
import type { FormEventType, PublicFormResponse, SubmitInput, SubmitResponse, UNLOCK_HEADER as UnlockHeader, UnlockResponse } from '@shared/api-public'

/**
 * Same value as UNLOCK_HEADER in shared/api-public.ts (the literal type keeps them in step).
 * Not imported at runtime: that module builds classic zod schemas, which would pull classic zod
 * into the respondent bundle.
 */
const UNLOCK_HEADER: typeof UnlockHeader = 'x-intelform-unlock'

/** The respondent's network calls: no router, no query cache, no credentials. */
const base = (slug: string) => `/api/public/forms/${encodeURIComponent(slug)}`

export class PublicApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[] | undefined>
  constructor(status: number, body?: ApiErrorBody['error']) {
    super(body?.message ?? 'Something went wrong. Try again.')
    this.status = status
    this.code = body?.code ?? 'unknown'
    this.fields = body?.fields ?? {}
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'omit', ...init })
  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) throw new PublicApiError(res.status, (data as ApiErrorBody | null)?.error)
  return data as T
}

export function fetchForm(slug: string, unlockToken?: string | null): Promise<PublicFormResponse> {
  return call(base(slug), { headers: unlockToken ? { [UNLOCK_HEADER]: unlockToken } : undefined })
}

export function unlockForm(slug: string, password: string): Promise<UnlockResponse> {
  return call(`${base(slug)}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
}

export function submitResponse(slug: string, input: SubmitInput): Promise<SubmitResponse> {
  return call(`${base(slug)}/responses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

/** Funnel event: sendBeacon (text/plain, no preflight), or a keepalive fetch. */
export function sendEvent(slug: string, type: FormEventType, session: string): void {
  const url = `${base(slug)}/events`
  const body = JSON.stringify({ type, session })
  try {
    if (navigator.sendBeacon?.(url, body)) return
  } catch {
    // fall through
  }
  void fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Storage: wrapped, because Safari throws inside some iframes (WebKit bug 299531).

export function storageGet(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key)
  } catch {
    return null
  }
}

export function storageSet(store: 'local' | 'session', key: string, value: string): void {
  try {
    ;(store === 'local' ? localStorage : sessionStorage).setItem(key, value)
  } catch {
    // storage blocked: the feature degrades, the form still works
  }
}

/** One uuid per form per browser session, for view/start dedupe. */
export function sessionToken(formId: string): string {
  const key = `if_s_${formId}`
  let t = storageGet('session', key)
  if (!t) {
    t = crypto.randomUUID()
    storageSet('session', key, t)
  }
  return t
}

/** The one-response-per-browser token, if this browser already responded. */
export function storedBrowserToken(formId: string): string | null {
  const name = `if_r_${formId}`
  const cookie = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return cookie?.slice(name.length + 1) || storageGet('local', name)
}

export function rememberBrowserToken(formId: string, token: string): void {
  const name = `if_r_${formId}`
  try {
    document.cookie = `${name}=${token}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  } catch {
    // cookies blocked
  }
  storageSet('local', name, token)
}

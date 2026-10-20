import type { ColorMode, DateFormat, EmailDriverName, SecretState } from '../../shared/settings-app'
import { sql, type Queryable } from '../db/client'
import { decryptSecret, encryptSecret } from './crypto'

/**
 * Typed app_settings keys. Fields named in SECRET_FIELDS hold `encryptSecret` output (or null)
 * and never leave the server; use `secretState` to describe them and `readSecret` to use them.
 */
export interface AppSettings {
  general: { appName: string; logoUrl: string | null; faviconUrl: string | null; timezone: string; dateFormat: DateFormat }
  branding: { accentColor: string | null; defaultMode: ColorMode; defaultThemeId: string | null }
  /** Shown as "Spam protection" in Settings. */
  turnstile: { siteKey: string | null; secret: string | null }
  email: {
    driver: EmailDriverName
    fromName: string | null
    fromAddress: string | null
    replyTo: string | null
    smtpHost: string | null
    smtpPort: number | null
    smtpSecure: boolean
    smtpUser: string | null
    smtpPass: string | null
    resendApiKey: string | null
    postmarkToken: string | null
  }
  data: { retentionDays: number | null }
  front_page: { enabled: boolean }
}

const DEFAULTS: AppSettings = {
  general: { appName: 'IntelForm', logoUrl: null, faviconUrl: null, timezone: 'UTC', dateFormat: 'DD/MM/YYYY' },
  branding: { accentColor: null, defaultMode: 'system', defaultThemeId: null },
  turnstile: { siteKey: null, secret: null },
  email: {
    driver: 'none',
    fromName: null,
    fromAddress: null,
    replyTo: null,
    smtpHost: null,
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: null,
    smtpPass: null,
    resendApiKey: null,
    postmarkToken: null,
  },
  data: { retentionDays: null },
  front_page: { enabled: false },
}

/** Fields that hold encrypted secrets, per key. */
export const SECRET_FIELDS = {
  turnstile: ['secret'],
  email: ['smtpPass', 'resendApiKey', 'postmarkToken'],
} as const satisfies Partial<{ [K in keyof AppSettings]: readonly (keyof AppSettings[K])[] }>

type Listener = (key: keyof AppSettings) => void
const listeners = new Set<Listener>()
/** Called after every setSetting, e.g. to drop a cached email transport. */
export function onSettingChange(fn: Listener): void {
  listeners.add(fn)
}

export async function getSetting<K extends keyof AppSettings>(key: K, tx: Queryable = sql): Promise<AppSettings[K]> {
  const [row] = await tx<{ value: AppSettings[K] }[]>`SELECT value FROM app_settings WHERE key = ${key}`
  return { ...DEFAULTS[key], ...row?.value }
}

/** Merges `value` into the stored object. Pass already-encrypted secrets (see `secretUpdate`). */
export async function setSetting<K extends keyof AppSettings>(key: K, value: Partial<AppSettings[K]>, tx: Queryable = sql): Promise<void> {
  const merged = { ...DEFAULTS[key], ...value }
  await tx`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${tx.json(merged as never)})
    ON CONFLICT (key) DO UPDATE SET value = app_settings.value || ${tx.json(value as never)}, updated_at = now()
  `
  settingsChanged(key)
}

/** Runs the change listeners (cache invalidation). setSetting calls it; call it again after a commit. */
export function settingsChanged(key: keyof AppSettings): void {
  for (const fn of listeners) fn(key)
}

// ---------------------------------------------------------------------------
// Secret helpers
// ---------------------------------------------------------------------------

/** The browser-safe description of a stored secret. */
export function secretState(stored: string | null | undefined): SecretState {
  return { set: !!stored }
}

/** Decrypts a stored secret; null when unset or unreadable (e.g. APP_SECRET changed). */
export function readSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  try {
    return decryptSecret(stored)
  } catch {
    return null
  }
}

/**
 * Turns a PATCH value into what is stored: undefined keeps the old value (field omitted),
 * null clears it, a string is encrypted.
 */
export function secretUpdate(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null || input === '') return null
  return encryptSecret(input)
}

/** Turnstile keys for the respondent submit route (Agent E). Null secret = Turnstile not configured. */
export async function getTurnstileConfig(): Promise<{ siteKey: string | null; secret: string | null }> {
  const t = await getSetting('turnstile')
  return { siteKey: t.siteKey, secret: readSecret(t.secret) }
}

import { LOCAL_UPLOAD_PREFIXES, getUploadCdnBase } from '../../shared/settings-app'

/*
 * Signature URLs this server stored. No server config import here, so pure code (the response
 * formatter, test and e2e fixtures) can use it; the CDN base comes from shared/settings-app,
 * which server/lib/uploads.ts sets at startup.
 */

/** Storage folder of one form's signature PNGs. */
export const signatureDir = (formId: string) => `intelform/signatures/${formId}/`
const SIGNATURE_FILE = /^intelform\/signatures\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/

/**
 * Storage path of a signature URL the server stored, or null for anything else. Both drivers'
 * URL prefixes are recognised, so a file written before a switch to (or from) Bunny still
 * resolves; it is then removed through the driver configured now.
 */
export function signaturePathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const bases: string[] = [...LOCAL_UPLOAD_PREFIXES]
  const cdn = getUploadCdnBase()
  if (cdn && cdn !== 'unknown') bases.push(cdn)
  for (const base of bases) {
    if (!url.startsWith(base)) continue
    const path = url.slice(base.length)
    if (SIGNATURE_FILE.test(path)) return path
  }
  return null
}

/**
 * The URL of a signature answer, only when it is `{ url }` pointing at a PNG this server stored.
 * Anything else (free text kept from before the field became a signature, an outside URL) is
 * not a signature and must never become a link or an image in the dashboard.
 */
export function storedSignatureUrl(value: unknown): string | null {
  const url = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { url?: unknown }).url : undefined
  return typeof url === 'string' && signaturePathFromUrl(url) !== null ? url : null
}

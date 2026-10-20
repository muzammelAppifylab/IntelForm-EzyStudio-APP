import type { ApiErrorBody } from '@shared/api'
import type { FormPatchInput, FormPatchResponse } from '@shared/api-forms'
import { ApiRequestError } from '@/lib/api'

/** PATCH /api/forms/:id with the revision it was based on (last save wins; see Agent D's route). */
export async function patchForm(formId: string, body: FormPatchInput, revision: number): Promise<FormPatchResponse> {
  let res: Response
  try {
    res = await fetch(`/api/forms/${formId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError(0, { code: 'offline', message: 'Can’t reach the server. Your changes are kept here and saved when you’re back online.' })
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error ?? { code: 'unknown', message: 'Saving failed. Try again.' }
    throw new ApiRequestError(res.status, error)
  }
  return data as FormPatchResponse
}

/**
 * Last-chance save when the tab is hidden or closed. keepalive requests are capped at 64 KB,
 * so a huge draft can't be flushed this way; beforeunload asks the browser to warn instead.
 */
export function keepalivePatch(formId: string, body: FormPatchInput, revision: number): boolean {
  const json = JSON.stringify(body)
  if (json.length > 60_000) return false
  try {
    void fetch(`/api/forms/${formId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
      body: json,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

/** Multipart upload to /api/uploads?purpose=… (5 MB, JPG/PNG/WebP, SVG for logos). */
export async function uploadImage(file: File, purpose: 'logo' | 'image' | 'og'): Promise<string> {
  const data = new FormData()
  data.set('file', file)
  let res: Response
  try {
    res = await fetch(`/api/uploads?purpose=${purpose}`, { method: 'POST', body: data, credentials: 'same-origin' })
  } catch {
    throw new ApiRequestError(0, { code: 'offline', message: 'Can’t reach the server. Check your connection and try again.' })
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = (body as ApiErrorBody | null)?.error ?? { code: 'unknown', message: 'Upload failed. Try again.' }
    const field = error.fields?.file?.[0]
    throw new ApiRequestError(res.status, { ...error, message: field ?? error.message })
  }
  // Local storage answers with a site-relative path; definitions and themes only accept
  // absolute http(s) URLs (safeUrl), so resolve it against this origin.
  return new URL((body as { url: string }).url, location.origin).href
}

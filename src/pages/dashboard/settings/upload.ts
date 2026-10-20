import type { UploadResult } from '@shared/api'
import { MAX_UPLOAD_BYTES, SVG_PURPOSES, type UploadPurpose } from '@shared/settings-app'
import { ApiRequestError } from '@/lib/api'

/** POST /api/uploads?purpose= with one multipart `file`. */
export async function uploadImage(file: File, purpose: UploadPurpose): Promise<UploadResult> {
  const body = new FormData()
  body.append('file', file)
  let res: Response
  try {
    res = await fetch(`/api/uploads?purpose=${purpose}`, { method: 'POST', body, credentials: 'same-origin' })
  } catch {
    throw new ApiRequestError(0, { code: 'offline', message: 'Can’t reach the server. Check your connection and try again.' })
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, data?.error ?? { code: 'unknown', message: 'The upload failed. Try again.' })
  return data as UploadResult
}

/** Client-side check before sending (the server checks the bytes again). */
export function checkImage(file: File, purpose: UploadPurpose): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'Choose an image under 5 MB'
  const types = ['image/jpeg', 'image/png', 'image/webp', ...(SVG_PURPOSES.includes(purpose) ? ['image/svg+xml'] : [])]
  if (!types.includes(file.type)) return SVG_PURPOSES.includes(purpose) ? 'Use a JPG, PNG, WebP or SVG image' : 'Use a JPG, PNG or WebP image'
  return null
}

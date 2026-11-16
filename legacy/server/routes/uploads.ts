import { Hono } from 'hono'
import type { UploadResult } from '../../shared/api'
import { UPLOAD_PURPOSES, type UploadPurpose } from '../../shared/settings-app'
import { can } from '../../shared/roles'
import { ApiError, forbidden } from '../lib/errors'
import { rateLimit } from '../lib/rate-limit'
import { decodeUploadPath, readLocalFile, storeImage } from '../lib/uploads'
import { requireUser, type AppEnv } from '../middleware/auth'

/**
 * Image uploads, proxied through the API (Bunny has no presigned uploads): multipart POST with
 * one `file` field. Owner and Editor only, except avatars, which every member may upload.
 * Bytes are sniffed; see lib/uploads.
 */
export const uploadsRoutes = new Hono<AppEnv>()

uploadsRoutes.post('/', requireUser, async (c) => {
  const purpose = c.req.query('purpose') as UploadPurpose | undefined
  if (!purpose || !UPLOAD_PURPOSES.includes(purpose)) {
    throw new ApiError(422, 'validation_failed', `Add ?purpose= with one of: ${UPLOAD_PURPOSES.join(', ')}`)
  }
  if (purpose !== 'avatar' && !can(c.var.user.role, 'forms.edit')) throw forbidden()
  await rateLimit(`upload:user:${c.var.user.id}`, 60, 10 * 60)

  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody()
  } catch {
    throw new ApiError(400, 'invalid_body', 'Send the image as multipart/form-data with a "file" field')
  }
  const file = body.file
  if (!(file instanceof File)) throw new ApiError(422, 'validation_failed', 'Choose an image to upload', { file: ['Choose an image to upload'] })

  const stored = await storeImage(file, purpose)
  return c.json<UploadResult>(stored, 201)
})

/** Serves files saved by the local-disk driver (no Bunny configured). Public, like a CDN. */
uploadsRoutes.get('/files/*', async (c) => {
  // A malformed escape (e.g. %E0%A4%A) is a 404, not a URIError 500.
  const rel = decodeUploadPath(c.req.path.replace(/^.*?\/uploads\/files\//, ''))
  const file = rel === null ? null : await readLocalFile(rel)
  if (!file) throw new ApiError(404, 'not_found', 'No such file')
  return c.body(new Uint8Array(file.buf), 200, {
    'Content-Type': file.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // An SVG opened directly must never run script or load anything.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  })
})

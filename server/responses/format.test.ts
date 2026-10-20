import '../test/env'
import { describe, expect, it } from 'vitest'
import type { FormField } from '../../shared/form/definition'
import { imageUrl, isUploadedFileUrl } from '../../shared/settings-app'
import { storedSignatureUrl } from '../lib/uploads'
import { displayAnswer } from './format'

const SIG = '/api/uploads/files/intelform/signatures/0b6b2d3e-9a4f-4d0e-8a51-2f7f4d1c9e10/5c2e8d4a-1f3b-4b6e-9c7d-8e2f1a0b3c4d.png'
const field = { id: 'f_sig', type: 'signature', label: 'Sign here', props: {} } as unknown as FormField

describe('signature answers', () => {
  it('links only PNGs this server stored', () => {
    expect(displayAnswer(field, { url: SIG })).toEqual({ text: 'Signed', url: SIG })
    expect(storedSignatureUrl({ url: SIG.replace('/api/uploads/files/', '/uploads/') })).not.toBeNull()
  })

  it('shows anything else as plain text', () => {
    // A text answer kept when the field's type changed to signature with the same id.
    expect(displayAnswer(field, 'https://tracker.example/pixel.png')).toEqual({ text: 'https://tracker.example/pixel.png' })
    expect(displayAnswer(field, 'javascript:alert(1)')).toEqual({ text: 'javascript:alert(1)' })
    for (const url of ['https://tracker.example/intelform/signatures/x.png', '/api/uploads/files/intelform/logo/x.png', `${SIG}/../../x.png`, 'data:image/png;base64,AAAA']) {
      expect(displayAnswer(field, { url }).url, url).toBeUndefined()
    }
  })
})

describe('uploaded image URLs', () => {
  it('accepts local uploads and the CDN, nothing else', () => {
    const cdn = 'https://intelform.b-cdn.net/'
    expect(isUploadedFileUrl('/api/uploads/files/intelform/avatar/a.png', null)).toBe(true)
    expect(isUploadedFileUrl('/uploads/intelform/logo/a.svg', null)).toBe(true)
    expect(isUploadedFileUrl(`${cdn}intelform/avatar/a.png`, cdn)).toBe(true)
    expect(isUploadedFileUrl(`${cdn}intelform/avatar/a.png`, null)).toBe(false)
    expect(isUploadedFileUrl('https://tracker.example/a.png', cdn)).toBe(false)
    expect(isUploadedFileUrl('https://intelform.b-cdn.net.evil.example/a.png', cdn)).toBe(false)
    expect(isUploadedFileUrl('/api/uploads/files/../secret', null)).toBe(false)
    expect(isUploadedFileUrl('/api/uploads/files//evil.example/a.png', null)).toBe(false)
    // Browser (CDN unknown): any https passes; the server checks the origin.
    expect(isUploadedFileUrl('https://intelform.b-cdn.net/a.png', 'unknown')).toBe(true)
    expect(isUploadedFileUrl('http://intelform.b-cdn.net/a.png', 'unknown')).toBe(false)
  })

  it('the avatar, logo and favicon schema refuses remote images on the server', () => {
    expect(imageUrl.safeParse('/api/uploads/files/intelform/avatar/a.png').success).toBe(true)
    const remote = imageUrl.safeParse('https://tracker.example/pixel.png')
    expect(remote.success).toBe(false)
    expect(remote.error?.issues[0].message).toMatch(/^Upload the image/)
  })
})

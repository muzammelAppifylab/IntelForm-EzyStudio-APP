import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { canvasPng, chunk, ihdr, png, rgbaChunks, rgbaRows } from '../test/png-fixtures'
import { crc32, validatePng } from './png'

const reason = async (buf: Buffer) => {
  try {
    await validatePng(buf)
    return 'ok'
  } catch (err) {
    return (err as Error).message
  }
}

/** The 1×1 grey + alpha PNG the submit tests use. */
const TINY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

describe('validatePng', () => {
  it('matches the standard CRC-32', () => {
    expect(crc32(Buffer.from('IEND'))).toBe(0xae426082)
  })

  it('accepts canvas-style PNGs', async () => {
    expect(await validatePng(TINY)).toEqual({ width: 1, height: 1 })
    expect(await validatePng(canvasPng())).toEqual({ width: 600, height: 176 })
    expect(await validatePng(canvasPng(1400, 352, true))).toEqual({ width: 1400, height: 352 })
    const icc = chunk('iCCP', Buffer.concat([Buffer.from('ICC\0\0'), deflateSync(Buffer.alloc(3000, 7))]))
    expect(await reason(png(rgbaChunks(10, 10, { before: [icc, chunk('iDOT', Buffer.alloc(28))] })))).toBe('ok')
  })

  it('accepts a palette image with transparency', async () => {
    const raw = Buffer.from([0, 0b00010000, 0, 0b01000000]) // 2×2, 2-bit indices
    const chunks = [ihdr(2, 2, 2, 3), chunk('PLTE', Buffer.alloc(9)), chunk('tRNS', Buffer.from([0])), chunk('IDAT', deflateSync(raw)), chunk('IEND')]
    expect(await reason(png(chunks))).toBe('ok')
  })

  it('rejects anything that is not a plain PNG image', async () => {
    const ok = rgbaChunks(4, 4)
    const [head, idat, iend] = ok
    expect(await reason(Buffer.from('<svg></svg>'.padEnd(80)))).toBe('not a PNG')
    // Payload chunks, before or after the image data.
    expect(await reason(png([head, chunk('tEXt', Buffer.from('Comment\0hello')), idat, iend]))).toBe('chunk tEXt not allowed')
    expect(await reason(png([head, idat, chunk('zzZz', Buffer.alloc(10)), iend]))).toBe('chunk zzZz not allowed')
    expect(await reason(png([head, idat, chunk('pHYs', Buffer.alloc(9)), iend]))).toBe('pHYs after IDAT')
    expect(await reason(png([head, chunk('pHYs', Buffer.alloc(9)), chunk('pHYs', Buffer.alloc(9)), idat, iend]))).toBe('second pHYs')
    expect(await reason(png([head, chunk('pHYs', Buffer.alloc(4000)), idat, iend]))).toBe('pHYs too large')
    expect(await reason(png([head, chunk('iCCP', Buffer.alloc(70_000)), idat, iend]))).toBe('iCCP too large')
    // Structure.
    expect(await reason(Buffer.concat([png(ok), Buffer.from('trailing')]))).toBe('bytes after IEND')
    expect(await reason(png([head, idat]))).toMatch(/IEND|truncated/)
    expect(await reason(png([idat, head, iend]))).toBe('IHDR must come first')
    expect(await reason(png([head, iend]))).toBe('missing IDAT')
    const broken = png(ok)
    broken[broken.length - 20] ^= 0xff
    expect(await reason(broken)).toMatch(/bad CRC/)
    const z = deflateSync(rgbaRows(4, 4))
    expect(await reason(png([head, chunk('IDAT', z.subarray(0, 5)), chunk('sRGB', Buffer.from([0])), chunk('IDAT', z.subarray(5)), iend]))).toMatch(/after IDAT|not consecutive/)
  })

  it('rejects bad headers', async () => {
    const body = rgbaChunks(4, 4).slice(1)
    expect(await reason(png([ihdr(5000, 10), ...body]))).toBe('bad image size')
    expect(await reason(png([ihdr(0, 10), ...body]))).toBe('bad image size')
    expect(await reason(png([ihdr(4, 4, 4, 6), ...body]))).toBe('bad colour type or bit depth')
    expect(await reason(png([ihdr(4, 4, 8, 5), ...body]))).toBe('bad colour type or bit depth')
    expect(await reason(png([ihdr(4, 4, 8, 6, 1), ...body]))).toBe('interlaced')
    // 4096×4096 RGBA16 would decode to 128 MB.
    expect(await reason(png([ihdr(4096, 4096, 16, 6), ...body]))).toBe('image too large')
  })

  it('requires the image data to match the header exactly', async () => {
    const [head, , iend] = rgbaChunks(4, 4)
    const idat = (raw: Buffer) => chunk('IDAT', deflateSync(raw))
    expect(await reason(png([head, idat(rgbaRows(4, 3)), iend]))).toBe('image data too short')
    expect(await reason(png([head, idat(rgbaRows(4, 5)), iend]))).toBe('image data too long')
    const badFilter = rgbaRows(4, 4)
    badFilter[17] = 9
    expect(await reason(png([head, idat(badFilter), iend]))).toBe('bad filter type')
    // Bytes hidden after the end of the zlib stream.
    expect(await reason(png([head, chunk('IDAT', Buffer.concat([deflateSync(rgbaRows(4, 4)), Buffer.from('hidden')])), iend]))).toBe('bytes after image data')
    expect(await reason(png([head, chunk('IDAT', Buffer.from('not zlib at all')), iend]))).toBe('bad image data')
  })

  it('stops a zip bomb early', async () => {
    // 1×1 header, 64 MB of zeros behind it (compresses to ~64 KB).
    const bomb = png([ihdr(1, 1), chunk('IDAT', deflateSync(Buffer.alloc(64 * 1024 * 1024))), chunk('IEND')])
    const started = Date.now()
    expect(await reason(bomb)).toBe('image data too long')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

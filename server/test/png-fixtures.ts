import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { crc32 } from '../lib/png'

/** Builds PNG files for tests: valid by default, with knobs to break each rule. */

export function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

export function ihdr(width: number, height: number, depth = 8, colour = 6, interlace = 0): Buffer {
  const d = Buffer.alloc(13)
  d.writeUInt32BE(width, 0)
  d.writeUInt32BE(height, 4)
  d.set([depth, colour, 0, 0, interlace], 8)
  return chunk('IHDR', d)
}

export const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Scanlines for an RGBA8 image: filter byte 0, then pixels (transparent, or random noise). */
export function rgbaRows(width: number, height: number, noise = false): Buffer {
  const row = 1 + width * 4
  const raw = noise ? randomBytes(height * row) : Buffer.alloc(height * row)
  for (let y = 0; y < height; y++) raw[y * row] = 0
  return raw
}

/** The chunks of an RGBA8 PNG, IDAT split in `parts` like browsers do. */
export function rgbaChunks(width: number, height: number, opts: { parts?: number; noise?: boolean; before?: Buffer[] } = {}): Buffer[] {
  const z = deflateSync(rgbaRows(width, height, opts.noise))
  const parts = opts.parts ?? 1
  const size = Math.ceil(z.length / parts)
  const idats: Buffer[] = []
  for (let i = 0; i < z.length; i += size) idats.push(chunk('IDAT', z.subarray(i, i + size)))
  return [ihdr(width, height), ...(opts.before ?? []), ...idats, chunk('IEND')]
}

export const png = (chunks: Buffer[]) => Buffer.concat([SIGNATURE, ...chunks])

/** A canvas-like RGBA PNG (sRGB + pHYs, split IDAT). */
export const canvasPng = (width = 600, height = 176, noise = false) =>
  png(rgbaChunks(width, height, { parts: 3, noise, before: [chunk('sRGB', Buffer.from([0])), chunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]))] }))

export const dataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`

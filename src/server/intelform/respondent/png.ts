/**
 * Strict PNG check for signature answers. A signature is stored as a public file, so it must be a
 * real, small, single image and nothing else: no extra chunks that could carry a payload, no
 * bytes after IEND, no data hidden after the zlib stream, no zip bomb.
 *
 * What browsers emit from canvas.toDataURL('image/png') (signature_pad calls it as is):
 * Chrome (Skia) IHDR, optionally sRGB / iCCP, IDAT…, IEND; Firefox IHDR, IDAT…, IEND;
 * Safari (ImageIO) IHDR, optionally sRGB / iCCP / pHYs / iDOT, IDAT…, IEND. All are 8-bit
 * RGBA (colour type 6), non-interlaced. The rules follow the PNG spec (ISO/IEC 15948) and accept
 * every valid non-interlaced colour type.
 *
 * Worker-safe: Uint8Array + DataView and the web DecompressionStream (no node:zlib, no Buffer).
 */

export const PNG_MAX_DIMENSION = 4096;
/** Decoded scanline bytes. A 2× DPR signature canvas (≈2400×360 RGBA) is about 3.5 MB. */
export const PNG_MAX_RAW_BYTES = 20 * 1024 * 1024;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ancillary chunks a canvas encoder may write, with their size limit. All must come before IDAT. */
const ANCILLARY: Record<string, {max: number; beforePlte: boolean}> = {
  sRGB: {max: 1, beforePlte: true},
  gAMA: {max: 4, beforePlte: true},
  cHRM: {max: 32, beforePlte: true},
  iCCP: {max: 64 * 1024, beforePlte: true},
  pHYs: {max: 9, beforePlte: false},
  // Apple's split-decoding hint (ImageIO).
  iDOT: {max: 4096, beforePlte: false},
};

/** Allowed bit depths per colour type, and channels per pixel. */
const COLOUR_TYPES: Record<number, {depths: number[]; channels: number}> = {
  0: {depths: [1, 2, 4, 8, 16], channels: 1},
  2: {depths: [8, 16], channels: 3},
  3: {depths: [1, 2, 4, 8], channels: 1},
  4: {depths: [8, 16], channels: 2},
  6: {depths: [8, 16], channels: 4},
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class PngError extends Error {}

export interface PngInfo {
  width: number;
  height: number;
}

const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

/** Resolves with the image size, or rejects with a PngError saying what is wrong. */
export async function validatePng(buf: Uint8Array): Promise<PngInfo> {
  const fail = (why: string): never => {
    throw new PngError(why);
  };
  if (buf.length < SIGNATURE.length + 12 || SIGNATURE.some((b, i) => buf[i] !== b)) fail('not a PNG');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let pos = 8;
  let ihdr: {width: number; height: number; depth: number; colour: number} | null = null;
  let paletteEntries = -1;
  const seen = new Set<string>();
  const idat: Uint8Array[] = [];
  let idatDone = false;
  let ended = false;

  while (pos < buf.length) {
    if (ended) fail('bytes after IEND');
    if (pos + 12 > buf.length) fail('truncated chunk');
    const len = view.getUint32(pos);
    const type = latin1(buf.subarray(pos + 4, pos + 8));
    if (len > 0x7fffffff || pos + 12 + len > buf.length) fail('truncated chunk');
    if (!/^[A-Za-z]{4}$/.test(type)) fail('bad chunk type');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== view.getUint32(pos + 8 + len)) fail(`bad CRC in ${type}`);
    pos += 12 + len;

    if (!ihdr && type !== 'IHDR') fail('IHDR must come first');
    if (type !== 'IDAT' && idat.length) idatDone = true;

    switch (type) {
      case 'IHDR': {
        if (ihdr) fail('second IHDR');
        if (len !== 13) fail('bad IHDR');
        const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const width = d.getUint32(0);
        const height = d.getUint32(4);
        const [depth, colour, compression, filter, interlace] = [data[8]!, data[9]!, data[10]!, data[11]!, data[12]!];
        if (width < 1 || height < 1 || width > PNG_MAX_DIMENSION || height > PNG_MAX_DIMENSION) fail('bad image size');
        const ct = COLOUR_TYPES[colour];
        if (!ct || !ct.depths.includes(depth)) fail('bad colour type or bit depth');
        if (compression !== 0 || filter !== 0) fail('bad compression or filter method');
        if (interlace !== 0) fail('interlaced');
        ihdr = {width, height, depth, colour};
        break;
      }
      case 'PLTE': {
        if (paletteEntries >= 0) fail('second PLTE');
        if (idat.length) fail('PLTE after IDAT');
        if (ihdr!.colour === 0 || ihdr!.colour === 4) fail('PLTE not allowed for this colour type');
        if (len === 0 || len % 3 !== 0 || len / 3 > 2 ** ihdr!.depth || len / 3 > 256) fail('bad PLTE');
        paletteEntries = len / 3;
        break;
      }
      case 'tRNS': {
        if (seen.has(type)) fail('second tRNS');
        if (idat.length) fail('tRNS after IDAT');
        const c = ihdr!.colour;
        if (c === 4 || c === 6) fail('tRNS not allowed for this colour type');
        if (c === 0 && len !== 2) fail('bad tRNS');
        if (c === 2 && len !== 6) fail('bad tRNS');
        if (c === 3 && (paletteEntries < 0 || len > paletteEntries)) fail('bad tRNS');
        break;
      }
      case 'IDAT':
        if (idatDone) fail('IDAT chunks not consecutive');
        if (ihdr!.colour === 3 && paletteEntries < 0) fail('missing PLTE');
        idat.push(data);
        break;
      case 'IEND':
        if (len !== 0) fail('bad IEND');
        ended = true;
        break;
      default: {
        const rule = ANCILLARY[type];
        if (!rule) fail(`chunk ${type} not allowed`);
        if (seen.has(type)) fail(`second ${type}`);
        if (len > rule!.max) fail(`${type} too large`);
        if (idat.length) fail(`${type} after IDAT`);
        if (rule!.beforePlte && paletteEntries >= 0) fail(`${type} after PLTE`);
      }
    }
    seen.add(type);
  }
  if (!ended) fail('missing IEND');
  if (!idat.length) fail('missing IDAT');

  const {width, height, depth, colour} = ihdr!;
  const rowBytes = 1 + Math.ceil((width * COLOUR_TYPES[colour]!.channels * depth) / 8);
  const expected = height * rowBytes;
  if (expected > PNG_MAX_RAW_BYTES) fail('image too large');
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const d of idat) {
    joined.set(d, at);
    at += d.length;
  }
  await checkImageData(joined, rowBytes, expected);
  return {width, height};
}

/**
 * Inflates the IDAT stream without keeping the output: it must be exactly `expected` bytes,
 * every scanline must start with a valid filter type (0–4), and the zlib stream must use every
 * input byte (the web DecompressionStream errors on trailing data). Stops as soon as the output
 * runs past `expected`.
 */
async function checkImageData(data: Uint8Array, rowBytes: number, expected: number): Promise<void> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // Errors surface on the reader; the writer's own promises are only awaited to avoid unhandled rejections.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  let out = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (out + value.length > expected) throw new PngError('image data too long');
      for (let i = (rowBytes - (out % rowBytes)) % rowBytes; i < value.length; i += rowBytes) {
        if (value[i]! > 4) throw new PngError('bad filter type');
      }
      out += value.length;
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    if (err instanceof PngError) throw err;
    throw new PngError('bad image data');
  }
  if (out !== expected) throw new PngError('image data too short');
}

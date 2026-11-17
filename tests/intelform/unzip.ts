import {expect} from 'vitest';

import {crc32} from '../../src/server/intelform/responses/zip';

/**
 * Reads a STORE-only ZIP back through its central directory, checking every record's signature
 * and each entry's CRC-32. For tests of the live export (src/server/intelform/exports/builders.ts).
 */
export function unzip(bytes: Uint8Array): {name: string; text: string; crcOk: boolean}[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    const start = offset + 30 + v.getUint16(offset + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(v.getUint32(start + size, true)).toBe(0x08074b50);
    out.push({
      name,
      text: new TextDecoder('utf-8', {ignoreBOM: true}).decode(data),
      crcOk: crc32(data) === crc,
    });
    p += 46 + nameLen;
  }
  return out;
}

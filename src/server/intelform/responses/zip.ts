/**
 * A streamed ZIP writer (STORE method, no compression), plain JavaScript so it runs on the
 * Worker: IntelForm used `archiver`, which needs Node streams and zlib. Each entry is written
 * as it is produced: a local header with the "sizes follow" flag, the bytes, then a data
 * descriptor with the CRC-32 and sizes; the central directory goes at the end. Only the
 * directory (a few dozen bytes per entry) is held in memory.
 *
 * Limits: no ZIP64, so the whole archive must stay under 4 GB (an export never comes close);
 * past that the writer throws instead of writing a broken file.
 */

export interface ZipEntry {
  name: string;
  /** The entry's content, as text chunks (UTF-8) or bytes. */
  chunks: AsyncIterable<string | Uint8Array>;
  date?: Date;
}

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (IEEE), continued from `crc` (start with 0). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  const t = crcTable();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date (UTC fields, 2-second precision, 1980 at the earliest). */
export function dosDateTime(d: Date): {time: number; date: number} {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** ZIP (no ZIP64) offsets and sizes stop here. */
export const ZIP_LIMIT = 0xffffffff;
const LIMIT = ZIP_LIMIT;
// Bit 3: sizes and CRC in a data descriptor after the data. Bit 11: the name is UTF-8.
const FLAGS = 0x0808;

const encoder = new TextEncoder();

export interface DirEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export function localHeader(name: Uint8Array, time: number, date: number): Uint8Array {
  const b = new Uint8Array(30 + name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, FLAGS, true);
  v.setUint16(8, 0, true); // STORE
  v.setUint16(10, time, true);
  v.setUint16(12, date, true);
  // CRC and sizes (14..25) are zero: they follow in the data descriptor.
  v.setUint16(26, name.length, true);
  v.setUint16(28, 0, true);
  b.set(name, 30);
  return b;
}

export function dataDescriptor(crc: number, size: number): Uint8Array {
  const b = new Uint8Array(16);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x08074b50, true);
  v.setUint32(4, crc, true);
  v.setUint32(8, size, true);
  v.setUint32(12, size, true);
  return b;
}

export function centralEntry(e: DirEntry): Uint8Array {
  const b = new Uint8Array(46 + e.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 20, true);
  v.setUint16(8, FLAGS, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, e.time, true);
  v.setUint16(14, e.date, true);
  v.setUint32(16, e.crc, true);
  v.setUint32(20, e.size, true);
  v.setUint32(24, e.size, true);
  v.setUint16(28, e.name.length, true);
  // extra (30), comment (32), disk (34), internal attributes (36), external attributes (38): zero.
  v.setUint32(42, e.offset, true);
  b.set(e.name, 46);
  return b;
}

export function endOfDirectory(count: number, size: number, offset: number): Uint8Array {
  const b = new Uint8Array(22);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  return b;
}

/** The ZIP's bytes, entry by entry. At most 65535 entries. */
export async function* zipChunks(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): AsyncGenerator<Uint8Array> {
  const dir: DirEntry[] = [];
  let offset = 0;
  const check = () => {
    if (offset > LIMIT) throw new Error('The export is too large for one ZIP file.');
  };
  for await (const entry of entries) {
    if (dir.length >= 0xffff) throw new Error('Too many files for one ZIP file.');
    const name = encoder.encode(entry.name);
    const {time, date} = dosDateTime(entry.date ?? new Date());
    const header = localHeader(name, time, date);
    const start = offset;
    yield header;
    offset += header.length;
    let crc = 0;
    let size = 0;
    for await (const chunk of entry.chunks) {
      const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
      if (!bytes.length) continue;
      crc = crc32(bytes, crc);
      size += bytes.length;
      offset += bytes.length;
      check();
      yield bytes;
    }
    const desc = dataDescriptor(crc, size);
    yield desc;
    offset += desc.length;
    check();
    dir.push({name, crc, size, offset: start, time, date});
  }
  const dirStart = offset;
  let dirSize = 0;
  for (const e of dir) {
    const b = centralEntry(e);
    dirSize += b.length;
    yield b;
  }
  if (dirStart + dirSize > LIMIT) throw new Error('The export is too large for one ZIP file.');
  yield endOfDirectory(dir.length, dirSize, dirStart);
}

/** A unique entry name for a form's CSV: its slug, then -2, -3… */
export function entryName(form: {id: string; slug: string}, used: Set<string>): string {
  const base = (form.slug || form.id).replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'form';
  let name = `${base}.csv`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}.csv`;
  used.add(name);
  return name;
}

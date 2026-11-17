import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {brotliDecompressSync} from 'node:zlib';

import {describe, expect, it} from 'vitest';

import {FONT_FILES} from '../../src/portal/intelform/builder/fonts';

/**
 * F-057: every web font the site redistributes from public/fonts must carry the notice the SIL
 * OFL 1.1 asks for (condition 2: "each copy contains the above copyright notice and this
 * license"). public/fonts/OFL.txt holds the licence and, for every file, its family's copyright
 * line, which this test reads straight out of the font's own `name` table so the two can never
 * drift apart when a font is added or replaced.
 */
const FONTS_DIR = fileURLToPath(new URL('../../public/fonts/', import.meta.url));
const woff2Files = readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2')).sort();
const ofl = readFileSync(`${FONTS_DIR}OFL.txt`, 'utf8');

/** The `name` table strings (Windows platform) of a WOFF2 file: id → string. */
function woff2Names(buf: Buffer): Record<number, string> {
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let p = 48;
  const readBase128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[p++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };
  const tables: {tag: number | string; length: number}[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++];
    let tag: number | string = flags & 0x3f;
    if (tag === 63) {
      tag = buf.toString('latin1', p, p + 4);
      p += 4;
    }
    const origLength = readBase128();
    const transform = (flags >> 6) & 3;
    const glyfOrLoca = tag === 10 || tag === 11;
    const length = (glyfOrLoca && transform === 0) || (!glyfOrLoca && transform !== 0) ? readBase128() : origLength;
    tables.push({tag, length});
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressedSize));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === 5) {
      const name = data.subarray(offset, offset + table.length);
      const count = name.readUInt16BE(2);
      const strings = name.readUInt16BE(4);
      const out: Record<number, string> = {};
      for (let i = 0; i < count; i++) {
        const r = 6 + i * 12;
        if (name.readUInt16BE(r) !== 3) continue;
        const id = name.readUInt16BE(r + 6);
        if (out[id] !== undefined) continue;
        const len = name.readUInt16BE(r + 8);
        const start = strings + name.readUInt16BE(r + 10);
        let s = '';
        for (let k = 0; k < len; k += 2) s += String.fromCharCode(name.readUInt16BE(start + k));
        out[id] = s;
      }
      return out;
    }
    offset += table.length;
  }
  throw new Error('no name table');
}

describe('public/fonts licences (F-057)', () => {
  it('ships the SIL Open Font License 1.1 text', () => {
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    for (const heading of ['PREAMBLE', 'DEFINITIONS', 'PERMISSION & CONDITIONS', 'TERMINATION', 'DISCLAIMER']) {
      expect(ofl).toContain(heading);
    }
    expect(ofl).toContain('provided that each copy\ncontains the above copyright notice and this license');
  });

  it('has fonts to check', () => {
    expect(woff2Files.length).toBeGreaterThan(0);
  });

  it.each(woff2Files)('%s: is OFL-licensed, listed in OFL.txt, with its copyright line', (file) => {
    const names = woff2Names(readFileSync(`${FONTS_DIR}${file}`));
    // nameID 14 is the licence URL: anything not under the OFL needs its own notice.
    expect(names[14] ?? '').toMatch(/scripts\.sil\.org\/OFL|openfontlicense\.org/);
    expect(ofl).toContain(file);
    expect(names[0]).toBeTruthy();
    expect(ofl).toContain(names[0]);
  });

  it('every theme font family has a licence entry', () => {
    for (const family of Object.keys(FONT_FILES)) expect(ofl).toContain(`Family: ${family}\n`);
  });
});

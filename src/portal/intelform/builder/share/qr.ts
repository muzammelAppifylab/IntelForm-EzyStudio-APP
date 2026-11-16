import {encode} from 'uqr';

import {escapeHtml, shortUrl} from './snippets';

/**
 * QR codes for the Share tab, from the template's `uqr` dependency (it replaces the old `qrcode`
 * package). High error correction (H), so a code still scans when printed small or a corner is
 * damaged. Black on white always: a QR code is the one place hex colours are fine (ui.md).
 *
 * The matrix and the SVG are pure (tested); `qrPngDataUrl` draws onto a canvas (browser only).
 */

export const QR_BORDER = 2;

export interface QrMatrix {
  /** Modules per side, border included. */
  size: number;
  /** `true` = a dark module. */
  data: boolean[][];
}

export function qrMatrix(text: string): QrMatrix {
  const qr = encode(text, {ecc: 'H', border: QR_BORDER});
  return {size: qr.size, data: qr.data};
}

/** One path for every dark module, row by row in runs: small, and crisp at any scale. */
export function qrPath(data: boolean[][]): string {
  let d = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return d;
}

/**
 * A standalone SVG file: the code on white, with the short link under it so a printed code can
 * be typed in too.
 */
export function qrSvg(url: string): string {
  const {size, data} = qrMatrix(url);
  const caption = shortUrl(url);
  const h = size + 4;
  const fontSize = Math.min(2.4, (size * 1.7) / Math.max(1, caption.length));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${h}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${h}" fill="#FFFFFF"/>` +
    `<path d="${qrPath(data)}" fill="#000000"/>` +
    `<text x="${size / 2}" y="${size + 2}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize.toFixed(2)}" fill="#000000">${escapeHtml(caption)}</text>` +
    `</svg>`
  );
}

/** A 1024 px PNG with the short link under the code. Browser only. */
export function qrPngDataUrl(url: string, width = 1024): string {
  const {size, data} = qrMatrix(url);
  const scale = Math.max(1, Math.floor(width / size));
  const side = size * scale;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side + 80;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw images. Download the SVG instead.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  data.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(x * scale, y * scale, scale, scale)));
  ctx.font = '36px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(shortUrl(url), side / 2, side + 48);
  return canvas.toDataURL('image/png');
}

/** Starts a download of `href` as `name`. */
export function downloadHref(href: string, name: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

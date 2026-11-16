/**
 * Checks the first bytes of a stored image against the type it was uploaded as. The old app
 * sniffed every upload before storing it (file-type); with direct uploads the bytes never pass
 * through the Worker, so the uploads route reads the start of the stored file back after
 * `completeUpload()` and deletes it when it isn't what it claims to be.
 */

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** The image type the bytes are, among those IntelForm accepts; null for anything else. */
export function sniffImageType(head: Uint8Array): string | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (head.length >= 6 && /^GIF8[79]a$/.test(ascii(head, 0, 6))) return 'image/gif';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (looksLikeSvg(new TextDecoder().decode(head.subarray(0, 1024)))) return 'image/svg+xml';
  return null;
}

/** An SVG document start: optional BOM, XML declaration, comments and doctype, then `<svg`. */
export function looksLikeSvg(text: string): boolean {
  const head = text.replace(/^﻿/, '').slice(0, 1024);
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/**
 * Active content an SVG logo must not carry: scripts, event handlers, embedded documents,
 * attribute animation, entity declarations, and any reference outside the file (href / src /
 * CSS url() / @import other than `#fragment`).
 *
 * The old app parsed the SVG twice (DOMPurify + an XML DOM, via jsdom: Node only). On the Worker
 * this is a stricter text check instead, and it is defence in depth: the platform serves SVG files
 * as downloads and browsers never run script in an SVG shown through `<img>`, which is the only
 * way IntelForm shows a logo or favicon.
 */
const ACTIVE_SVG = [
  /<\s*(?:[a-z0-9_-]+:)?(?:script|foreignobject|iframe|embed|object|handler|listener|set|animate|animatemotion|animatetransform|discard|html|body|math)\b/i,
  /<!ENTITY/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /(?:^|[\s"'])(?:xlink:)?(?:href|src)\s*=\s*(["'])\s*(?!#)[^"'\s]/i,
  /(?:^|[\s"'])(?:xlink:)?(?:href|src)\s*=\s*(?!["'#])[^\s>]/i,
  /@import/i,
  /url\(\s*(?:['"]\s*)?(?!#)[^)\s'"]/i,
];

export function isCleanSvg(svg: string): boolean {
  if (!looksLikeSvg(svg)) return false;
  // An element in the XHTML or MathML namespace is live HTML inside an SVG.
  if (/w3\.org\/1999\/xhtml|w3\.org\/1998\/Math\/MathML/i.test(svg)) return false;
  // Namespace declarations are links in name only; leave them out of the reference check.
  const body = svg.replace(/\sxmlns(?::[a-z0-9_-]+)?\s*=\s*(["'])[^"']*\1/gi, '');
  return !ACTIVE_SVG.some(re => re.test(body));
}

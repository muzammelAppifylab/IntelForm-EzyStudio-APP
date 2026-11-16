import {describe, expect, it} from 'vitest';

import {qrMatrix, qrPath, qrSvg, QR_BORDER} from '../../src/portal/intelform/builder/share/qr';
import {
  DEFAULT_EMBED,
  embedSnippet,
  escapeHtml,
  formUrl,
  popupSnippet,
  safeHex,
  shortUrl,
} from '../../src/portal/intelform/builder/share/snippets';

const ORIGIN = 'https://forms.example.com';

describe('formUrl / shortUrl', () => {
  it('builds the public /f/<slug>/ link', () => {
    expect(formUrl(ORIGIN, 'contact-us')).toBe('https://forms.example.com/f/contact-us/');
    expect(formUrl(`${ORIGIN}/`, 'a b')).toBe('https://forms.example.com/f/a%20b/');
  });
  it('drops the scheme for captions', () => {
    expect(shortUrl('https://x.test/f/a/')).toBe('x.test/f/a/');
    expect(shortUrl('http://x.test')).toBe('x.test');
  });
});

describe('embedSnippet', () => {
  it('defaults to a full-width iframe plus embed.js', () => {
    const code = embedSnippet(ORIGIN, 'nps', 'How are we doing?', DEFAULT_EMBED);
    expect(code).toContain(`src="${ORIGIN}/f/nps/?embed=1"`);
    expect(code).toContain('width:100%;max-width:100%;height:600px');
    expect(code).toContain(`<script src="${ORIGIN}/embed.js" async></script>`);
  });
  it('adds the options and clamps sizes', () => {
    const code = embedSnippet(ORIGIN, 'nps', 'T', {width: 'fixed', px: '100', height: 'abc', transparent: true, hideTitle: true});
    expect(code).toContain('?embed=1&transparent=1&hideTitle=1');
    expect(code).toContain('width:240px');
    expect(code).toContain('height:600px');
    expect(embedSnippet(ORIGIN, 'x', 'T', {...DEFAULT_EMBED, width: 'fixed', px: '800', height: '900'})).toContain('width:800px;max-width:100%;height:900px');
  });
  it('escapes the title', () => {
    const code = embedSnippet(ORIGIN, 'x', 'Say "hi" <b>&', DEFAULT_EMBED);
    expect(code).toContain('title="Say &quot;hi&quot; &lt;b&gt;&amp;"');
  });
});

describe('popupSnippet', () => {
  it('uses the label and colours, escaped', () => {
    const code = popupSnippet(ORIGIN, 'nps', {label: '<Go>', color: '#123abc', textColor: '#ffffff'});
    expect(code).toContain('data-intelform-popup="nps"');
    expect(code).toContain('background:#123ABC;color:#FFFFFF');
    expect(code).toContain('>&lt;Go&gt;</button>');
  });
  it('falls back for a blank label and a bad colour', () => {
    const code = popupSnippet(ORIGIN, 'nps', {label: '  ', color: 'red;x:1', textColor: 'nope'});
    expect(code).toContain('>Open form</button>');
    expect(code).toContain('background:#211D2A;color:#FFFFFF');
  });
  it('safeHex accepts #RRGGBB only', () => {
    expect(safeHex('#abcdef', '#000000')).toBe('#ABCDEF');
    expect(safeHex('#abc', '#000000')).toBe('#000000');
  });
  it('escapeHtml', () => {
    expect(escapeHtml('a&b<"c">')).toBe('a&amp;b&lt;&quot;c&quot;&gt;');
  });
});

describe('qr', () => {
  const url = `${ORIGIN}/f/contact-us/`;
  it('encodes a square matrix with a white border', () => {
    const {size, data} = qrMatrix(url);
    expect(data).toHaveLength(size);
    expect(data.every(row => row.length === size)).toBe(true);
    for (let i = 0; i < QR_BORDER; i++) {
      expect(data[i]!.some(Boolean)).toBe(false);
      expect(data[size - 1 - i]!.some(Boolean)).toBe(false);
    }
    // A finder pattern starts right inside the border.
    expect(data[QR_BORDER]![QR_BORDER]).toBe(true);
  });
  it('turns runs of dark modules into one path segment each', () => {
    expect(qrPath([[false, true, true, false, true]])).toBe('M1 0h2v1h-2zM4 0h1v1h-1z');
    expect(qrPath([[false], [true]])).toBe('M0 1h1v1h-1z');
  });
  it('writes a standalone SVG with the caption', () => {
    const svg = qrSvg(url);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).toContain('>forms.example.com/f/contact-us/</text>');
    const {size} = qrMatrix(url);
    expect(svg).toContain(`viewBox="0 0 ${size} ${size + 4}"`);
  });
});

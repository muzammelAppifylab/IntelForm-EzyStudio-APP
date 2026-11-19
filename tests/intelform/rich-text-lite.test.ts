import fc from 'fast-check';
import {describe, expect, it} from 'vitest';

import {sanitizeRichText} from '../../src/lib/intelform/form/rich-text';
import {sanitizeRichTextBest, sanitizeRichTextLite} from '../../src/lib/intelform/form/rich-text-core';

/**
 * The respondent's allow-list sanitizer (no `xss` package in its bundle) against the full one the
 * server and builder run: the same canonical subset, and never anything outside it.
 */

const ALLOWED_TAG = /^<\/?(p|ul|ol|li|strong|em|u|s|br)>$|^<a( target="_blank" rel="noopener noreferrer nofollow ugc" href="[^"<>]*")?>$|^<\/a>$/;

/** Every `<` starts one of the subset's own tags; a link's only attribute is a checked href. */
function onlySubset(html: string) {
  for (const tag of html.match(/<[^>]*>?/g) ?? []) {
    expect(tag, html).toMatch(ALLOWED_TAG);
    expect(tag, html).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
  }
}

/** Quotes in text may be spelled either way: the same text on the page. */
const sameText = (html: string) => html.replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const CANONICAL = [
  '<p>Hello <strong>you</strong> and <em>them</em></p>',
  '<p>A <a href="https://example.com/x?a=1&amp;b=2">link</a></p>',
  '<ul><li>one</li><li>two <u>under</u> <s>gone</s></li></ul><ol><li>first</li></ol>',
  '<p>line<br>break</p><p><br></p>',
  '<p>5 &lt; 6 &amp; "quotes" it&#39;s</p>',
  '<b>bold</b> <i>it</i> <del>x</del> <strike>y</strike>',
  '<div>loose <span style="color:red">span</span></div><p>p</p>',
  'mail <a href="mailto:a@example.com">me</a> or <a href="tel:+15550100">call</a>',
];

const HOSTILE = [
  '<script>alert(1)</script><p>ok</p>',
  '<img src=x onerror=alert(1)>text',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" jav&#x09;ascript:alert(1)">x</a>',
  '<a href="https://ok.example" onclick="alert(1)">x</a>',
  '<svg><script>alert(1)</script></svg>after',
  '<p onmouseover="alert(1)">hi</p>',
  '<style>p{color:red}</style><p>styled</p>',
  '<!-- <script>alert(1)</script> --><p>c</p>',
  '<iframe src="https://evil.example"></iframe>f',
  '<a href="https://x.example"<script>alert(1)</script>',
  '<<script>script>alert(1)<</script>/script>',
  '<p>unclosed <strong>bold',
  '<a href=\'https://single.example\'>q</a>',
  '<math><mi xlink:href="javascript:alert(1)">m</mi></math>',
  '<textarea><p>not html</p></textarea>t',
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  '<p title="a>b">attr with bracket</p>',
];

describe('sanitizeRichTextLite', () => {
  it('gives the same canonical HTML as the full sanitizer on rich text the app writes', () => {
    for (const html of CANONICAL) {
      expect(sameText(sanitizeRichTextLite(html)), html).toBe(sameText(sanitizeRichText(html)));
      expect(sameText(sanitizeRichTextLite(html, {inline: true})), html).toBe(sameText(sanitizeRichText(html, {inline: true})));
    }
  });

  it('never lets anything outside the subset through', () => {
    for (const html of HOSTILE) {
      onlySubset(sanitizeRichTextLite(html));
      onlySubset(sanitizeRichTextLite(html, {inline: true}));
    }
    expect(sanitizeRichTextLite('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichTextLite('<a href="javascript:alert(1)">x</a>')).toBe('<p><a>x</a></p>');
    expect(sanitizeRichTextLite('<p>&lt;script&gt;</p>')).toBe('<p>&lt;script&gt;</p>');
  });

  it('builds only the subset from any input (fuzzed)', () => {
    const piece = fc.oneof(
      fc.string(),
      fc.constantFrom('<', '>', '"', "'", '&', '<p>', '</p>', '<a href="', 'javascript:', '<script>', '</script>', '<!--', '-->', ' onerror=', '<br/>', '<svg>', '&#x3c;'),
    );
    fc.assert(
      fc.property(fc.array(piece, {maxLength: 30}), parts => {
        const html = parts.join('');
        onlySubset(sanitizeRichTextLite(html));
        // Idempotent: clean output comes back unchanged.
        const once = sanitizeRichTextLite(html);
        expect(sanitizeRichTextLite(once)).toBe(once);
      }),
      {numRuns: 500}
    );
  });

  it('the best sanitizer is the full one wherever ./rich-text.ts is loaded (the server)', () => {
    const html = '<p>x <a href="https://example.com">y</a></p>';
    expect(sanitizeRichTextBest(html)).toBe(sanitizeRichText(html));
  });
});

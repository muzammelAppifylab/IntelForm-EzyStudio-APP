import { FilterXSS } from 'xss'
import { sanitizeHtml } from '../../../platform/sanitize'
import { BLOCK_TAGS, BREAKING, canonicalRichText, DROP_BODY, escapeHtml, INLINE_TAGS, safeLinkHref, setRichTextSanitizer } from './rich-text-core'

export * from './rich-text-core'

/**
 * The full rich text sanitizer (the server, the builder): the strict subset through `xss`, then
 * the platform's sanitizer, the rule for any HTML from outside the repo before it is stored or
 * rendered on the server. The subset, shapes and helpers are in ./rich-text-core.ts (the
 * respondent's bundle uses that file's `sanitizeRichTextLite`, the same subset with no library).
 */

function makeFilter(inline: boolean): FilterXSS {
  const whiteList: Record<string, string[]> = {}
  for (const t of INLINE_TAGS) whiteList[t] = t === 'a' ? ['href'] : []
  if (!inline) {
    for (const t of BLOCK_TAGS) whiteList[t] = []
    whiteList.br = []
  }
  return new FilterXSS({
    whiteList,
    allowCommentTag: false,
    stripBlankChar: true,
    stripIgnoreTagBody: DROP_BODY,
    onIgnoreTag(tag) {
      // A dropped block (or a <br> in a single-line answer) still separates the words around it.
      return BREAKING.test(tag.toLowerCase()) ? ' ' : ''
    },
    onTagAttr(tag, name, value) {
      if (tag === 'a' && name === 'href') {
        const href = safeLinkHref(value)
        return href ? `href="${escapeHtml(href)}"` : ''
      }
      return ''
    },
  })
}

let blockFilter: FilterXSS | null = null
let inlineFilter: FilterXSS | null = null

/**
 * Rich text HTML → the fixed subset (see the top of this file). Run it right before any
 * `dangerouslySetInnerHTML`, after piping. `inline` (a single-line answer) also drops
 * paragraphs, lists and line breaks. Idempotent: clean HTML comes back unchanged.
 */
export function sanitizeRichText(html: string, opts: { inline?: boolean } = {}): string {
  if (!html) return ''
  const filter = opts.inline ? (inlineFilter ??= makeFilter(true)) : (blockFilter ??= makeFilter(false))
  // The strict subset first (it drops what it doesn't know instead of showing it as text), then the
  // platform's sanitizer (the rule for any HTML from outside the repo; a no-op on the subset), then
  // the canonical spelling and the attributes every link gets.
  return canonicalRichText(sanitizeHtml(filter.process(html)), !!opts.inline)
}

// Everything that loads this file checks rich answers with the full sanitizer too.
setRichTextSanitizer(sanitizeRichText)

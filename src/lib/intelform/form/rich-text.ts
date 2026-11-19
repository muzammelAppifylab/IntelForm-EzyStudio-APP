import { FilterXSS } from 'xss'
import { sanitizeHtml } from '../../../platform/sanitize'

/**
 * Rich text for question descriptions and for text answers with "Rich text answers" on.
 *
 * Stored as a small, fixed HTML subset: paragraphs, line breaks, bold, italic, underline,
 * strikethrough, bulleted and numbered lists, and links (http, https, mailto, tel). Nothing
 * else survives `sanitizeRichText`: no attributes but a checked `href`, no styles, no images.
 * Every place that shows rich text runs it through `sanitizeRichText` right before rendering
 * (after answer piping), and the server runs it on save, so stored HTML is already clean.
 *
 * Pure JavaScript (no DOM): the Worker, the builder and the public form share it.
 *
 * Shapes:
 * - a description is a string; `descriptionFormat: 'html'` marks it as rich text, otherwise it is
 *   the older plain text (shown with its line breaks). `descriptionToHtml` reads both.
 * - a rich text answer is `{ html }`, so it is never mistaken for a plain answer that happens to
 *   contain "<b>" (and stays readable when the setting is later turned off).
 */

/** Longest stored description HTML (the text itself is limited to DESCRIPTION_TEXT_MAX). */
export const DESCRIPTION_HTML_MAX = 10_000
/** Longest description text, as before rich text. */
export const DESCRIPTION_TEXT_MAX = 2000

export interface RichAnswer {
  html: string
}

export function isRichAnswer(v: unknown): v is RichAnswer {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { html?: unknown }).html === 'string'
}

// ---------------------------------------------------------------------------------- escaping

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Text → HTML text (also safe inside a double-quoted attribute). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** The entities our HTML can hold, back to characters. Unknown ones stay as they are. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8}|#39);/gi, (m, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[name.toLowerCase()] ?? m
  })
}

// ---------------------------------------------------------------------------------- links

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * A link a person typed ("example.com", "https://…", "mailto:…") as a safe href, or null.
 * Bare addresses get https://; anything but http, https, mailto and tel is refused.
 */
export function safeLinkHref(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const t = decodeEntities(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!t || t.length > 2048) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(t) ? `mailto:${t}` : `https://${t}`
  try {
    const u = new URL(withScheme)
    if (!LINK_PROTOCOLS.has(u.protocol)) return null
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : withScheme
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------- sanitizer

const INLINE_TAGS = ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a'] as const
const BLOCK_TAGS = ['p', 'ul', 'ol', 'li'] as const
/** Elements whose end (or a <br>) separates words: kept as a space when they are dropped. */
const BREAKING = /^(p|div|li|ul|ol|br|h[1-6]|blockquote|tr|td|th|section|article|header|footer|pre)$/
/** Elements whose content is never text a person meant to keep. */
const DROP_BODY = ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'select', 'title', 'svg', 'math', 'head']

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
  const out = sanitizeHtml(filter.process(html))
    .replace(/<b>/g, '<strong>')
    .replace(/<\/b>/g, '</strong>')
    .replace(/<i>/g, '<em>')
    .replace(/<\/i>/g, '</em>')
    .replace(/<(strike|del)>/g, '<s>')
    .replace(/<\/(strike|del)>/g, '</s>')
    .replace(/<br\s*\/?>/g, '<br>')
    .replace(/<a href="/g, '<a target="_blank" rel="noopener noreferrer nofollow ugc" href="')
    .replace(/\n/g, ' ')
  // One line: the spaces left where blocks were dropped collapse, as the browser shows them.
  return opts.inline ? out.replace(/\s{2,}/g, ' ').trim() : wrapLoose(out)
}

/**
 * Text and marks outside any block (left where a <div> was dropped) go into paragraphs, so the
 * stored HTML is always a list of <p>, <ul> and <ol>. Spaces between blocks are dropped.
 */
function wrapLoose(html: string): string {
  if (!html) return html
  let depth = 0
  let loose = ''
  let out = ''
  const flush = () => {
    if (loose.trim()) out += `<p>${loose.trim()}</p>`
    loose = ''
  }
  for (const m of html.matchAll(/<(\/?)(p|ul|ol)>|<[^>]*>|[^<]+/g)) {
    const [token, closing, block] = m
    if (block) {
      if (!closing && depth === 0) flush()
      depth = Math.max(0, depth + (closing ? -1 : 1))
      out += token
    } else if (depth === 0) loose += token
    else out += token
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------------- conversions

/** Plain text → rich text HTML: one paragraph per line (a blank line stays a blank paragraph). */
export function plainToHtml(text: string, inline = false): string {
  if (!text) return ''
  if (inline) return escapeHtml(text.replace(/\s*\n\s*/g, ' '))
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('')
}

/**
 * Rich text HTML → plain text, for CSV, emails, search, logic and piping: paragraphs and line
 * breaks become new lines, list items start with "• " (or "1. "), links keep their text.
 */
export function htmlToPlain(html: string): string {
  if (!html) return ''
  if (!html.includes('<')) return decodeEntities(html).replace(/ /g, ' ')
  const lists: { ordered: boolean; n: number }[] = []
  let out = ''
  const re = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+)|</gi
  let m: RegExpExecArray | null
  // Inside <script>, <style>… (never in stored answers, which are clean): no text.
  let skipping: string | null = null
  while ((m = re.exec(html))) {
    if (skipping) {
      if (m[1] === '/' && m[2]?.toLowerCase() === skipping) skipping = null
      continue
    }
    if (m[3] !== undefined) {
      out += decodeEntities(m[3])
      continue
    }
    if (m[2] === undefined) {
      out += '<'
      continue
    }
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (!closing && DROP_BODY.includes(tag)) {
      skipping = tag
      continue
    }
    if (tag === 'br') out += '\n'
    else if (tag === 'ul' || tag === 'ol') {
      if (closing) lists.pop()
      else lists.push({ ordered: tag === 'ol', n: 0 })
      if (out && !out.endsWith('\n')) out += '\n'
    } else if (tag === 'li') {
      if (closing) {
        if (!out.endsWith('\n')) out += '\n'
      } else {
        const list = lists[lists.length - 1]
        if (out && !out.endsWith('\n')) out += '\n'
        const depth = Math.max(0, lists.length - 1)
        out += '  '.repeat(depth) + (list?.ordered ? `${++list.n}. ` : '• ')
      }
    } else if (BREAKING.test(tag) && closing) {
      if (!out.endsWith('\n')) out += '\n'
    } else if (BREAKING.test(tag) && out && !out.endsWith('\n')) {
      out += '\n'
    }
  }
  return out
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** True when the HTML shows no text (only tags, spaces, empty paragraphs). */
export function isBlankHtml(html: string | undefined | null): boolean {
  return !html || htmlToPlain(html).trim() === ''
}

/** Any text answer (plain string or rich `{html}`) as plain text. */
export function answerPlainText(v: unknown): string {
  if (typeof v === 'string') return v
  if (isRichAnswer(v)) return htmlToPlain(v.html)
  return ''
}

/** A description (plain or rich) as rich text HTML, not yet sanitized or piped. */
export function descriptionToHtml(description: string | undefined, format: 'html' | undefined): string {
  if (!description) return ''
  return format === 'html' ? description : plainToHtml(description)
}

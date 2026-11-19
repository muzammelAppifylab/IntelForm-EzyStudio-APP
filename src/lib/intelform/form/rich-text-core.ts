
/**
 * Rich text, the part with no HTML library (the respondent's bundle loads only this; the
 * server and the builder use ./rich-text.ts, which adds the `xss` + platform sanitizer).
 *
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

export const INLINE_TAGS = ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a'] as const
export const BLOCK_TAGS = ['p', 'ul', 'ol', 'li'] as const
/** Elements whose end (or a <br>) separates words: kept as a space when they are dropped. */
export const BREAKING = /^(p|div|li|ul|ol|br|h[1-6]|blockquote|tr|td|th|section|article|header|footer|pre)$/
/** Elements whose content is never text a person meant to keep. */
export const DROP_BODY = ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'select', 'title', 'svg', 'math', 'head']

/**
 * The canonical spelling of the subset (<strong>, <em>, <s>, <br>, the attributes every link
 * gets), on HTML that holds nothing but the subset. Shared by both sanitizers.
 */
export function canonicalRichText(subset: string, inline: boolean): string {
  const out = subset
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
  return inline ? out.replace(/\s{2,}/g, ' ').trim() : wrapLoose(out)
}

// eslint-disable-next-line no-control-regex
const BLANK_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!?\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<|[^<]+/g
const HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

/**
 * The same subset as `sanitizeRichText` in ./rich-text.ts, with no HTML library: an allow-list
 * that BUILDS its output, so nothing it was given can reach the page as markup. Every text run is
 * decoded and escaped again; a tag is written only when it is in the subset, by name, with no
 * attribute but a checked `href` (safeLinkHref, escaped); comments and the content of script,
 * style and the like are dropped; any other tag is dropped and its text kept (a space for one
 * that breaks words). The browser then parses only this canonical output, so it can't read the
 * input differently from this tokenizer. Used where the `xss` package would be too heavy (the
 * respondent's bundle); the server always runs the full one before anything is stored.
 */
export function sanitizeRichTextLite(html: string, opts: { inline?: boolean } = {}): string {
  if (!html) return ''
  const inline = !!opts.inline
  const allowed = new Set<string>(inline ? INLINE_TAGS : [...INLINE_TAGS, ...BLOCK_TAGS, 'br'])
  let out = ''
  let skipping: string | null = null
  for (const m of html.replace(BLANK_CHARS, '').matchAll(TOKEN)) {
    const [token, rawName, attrs] = m
    if (token.startsWith('<!--')) continue
    if (rawName === undefined) {
      if (!skipping) out += token === '<' ? '&lt;' : escapeHtml(decodeEntities(token))
      continue
    }
    const name = rawName.toLowerCase()
    const closing = token.startsWith('</')
    if (skipping) {
      if (closing && name === skipping) skipping = null
      continue
    }
    if (token.startsWith('<!')) continue
    if (!closing && DROP_BODY.includes(name)) {
      if (!/\/\s*$/.test(attrs ?? '')) skipping = name
      continue
    }
    if (!allowed.has(name)) {
      out += BREAKING.test(name) ? ' ' : ''
      continue
    }
    if (closing) {
      if (name !== 'br') out += `</${name}>`
      continue
    }
    if (name === 'a') {
      const h = HREF.exec(attrs ?? '')
      const href = h ? safeLinkHref(h[1] ?? h[2] ?? h[3] ?? '') : null
      out += href ? `<a href="${escapeHtml(href)}">` : '<a>'
    } else out += `<${name}>`
  }
  return canonicalRichText(out, inline)
}

type Sanitizer = (html: string, opts?: { inline?: boolean }) => string
let full: Sanitizer | null = null

/** ./rich-text.ts puts the full sanitizer here when it loads (the server, the builder). */
export function setRichTextSanitizer(fn: Sanitizer): void {
  full = fn
}

/**
 * The strongest sanitizer this bundle holds: the full one (`xss` + the platform's) wherever
 * ./rich-text.ts is loaded, as on the server, which imports it before any answer is checked
 * (src/server/intelform/respondent/validators.ts); the lite one in the respondent's bundle, whose
 * checks are only for the person filling in (the server checks every answer again).
 */
export function sanitizeRichTextBest(html: string, opts: { inline?: boolean } = {}): string {
  return (full ?? sanitizeRichTextLite)(html, opts)
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

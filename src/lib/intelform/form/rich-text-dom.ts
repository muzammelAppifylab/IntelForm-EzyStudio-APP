import { escapeHtml, safeLinkHref, sanitizeRichTextLite as sanitizeRichText } from './rich-text-core'

/**
 * Browser-only half of rich text: turns what a contentEditable holds (whatever the browser or a
 * paste put there: <b>, <div>, Google Docs spans…) into the canonical subset of rich-text.ts.
 * Used by the builder's description editor and the respondent's rich text answer box.
 */

export interface SerializeOptions {
  /** A single-line answer: no paragraphs, lists or line breaks. */
  inline?: boolean
  /** Text to store for a non-text node the editor owns (a pipe chip), or null to treat it normally. */
  atom?: (el: HTMLElement) => string | null
}

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'TR', 'FIGURE', 'ADDRESS'])
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'TEXTAREA', 'SELECT', 'TITLE', 'SVG', 'MATH', 'HEAD', 'META', 'LINK', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'BUTTON', 'INPUT'])
const MARKS: Record<string, string> = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's' }

/** Marks a pasted <span style> carries (Google Docs, Word). */
function styleMarks(el: HTMLElement): string[] {
  const s = el.style
  if (!s) return []
  const out: string[] = []
  const weight = s.fontWeight
  if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) out.push('strong')
  if (s.fontStyle === 'italic') out.push('em')
  const deco = `${s.textDecoration} ${s.textDecorationLine}`
  if (deco.includes('underline')) out.push('u')
  if (deco.includes('line-through')) out.push('s')
  return out
}

/** The canonical HTML of `root`'s children ('' when it shows nothing). */
export function serializeRichText(root: Node, opts: SerializeOptions = {}): string {
  const inline = !!opts.inline
  const blocks: string[] = []
  let line = ''

  const flush = (force = false) => {
    const content = line.replace(/(<br>)+$/, '')
    if (content.trim() || (force && line.includes('<br>'))) blocks.push(`<p>${content.trim() ? content : '<br>'}</p>`)
    line = ''
  }

  /** Inline content of a node: text, marks, links, atoms; blocks inside become line breaks. */
  const inlineOf = (node: Node): string => {
    let out = ''
    node.childNodes.forEach((child) => {
      out += inlineNode(child)
    })
    return out
  }

  const inlineNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml((node as Text).data.replace(/[\r\n]+/g, ' '))
    if (!(node instanceof HTMLElement)) return ''
    const atom = opts.atom?.(node)
    if (atom != null) return escapeHtml(atom)
    const tag = node.tagName
    if (SKIP.has(tag) || node.dataset.sentinel !== undefined) return ''
    if (tag === 'BR') return inline ? ' ' : '<br>'
    let inner = inlineOf(node)
    if (BLOCK.has(tag) || tag === 'LI' || tag === 'UL' || tag === 'OL') inner = inline ? ` ${inner} ` : `${inner}<br>`
    if (!inner) return ''
    if (tag === 'A') {
      const href = safeLinkHref(node.getAttribute('href') ?? '')
      return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner
    }
    const marks = MARKS[tag] ? [MARKS[tag]] : tag === 'SPAN' || tag === 'FONT' ? styleMarks(node) : []
    for (const m of marks) inner = `<${m}>${inner}</${m}>`
    return inner
  }

  const listOf = (list: HTMLElement): string => {
    const tag = list.tagName === 'OL' ? 'ol' : 'ul'
    let items = ''
    list.childNodes.forEach((child) => {
      if (child instanceof HTMLElement && child.tagName === 'LI') {
        let text = ''
        let nested = ''
        child.childNodes.forEach((n) => {
          if (n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL')) nested += listOf(n)
          else text += inlineNode(n)
        })
        text = text.replace(/(<br>)+$/, '')
        if (text.trim() || nested) items += `<li>${text.trim() ? text : '<br>'}${nested}</li>`
      } else if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) {
        items += `<li>${listOf(child)}</li>`
      } else {
        const text = inlineNode(child)
        if (text.trim()) items += `<li>${text}</li>`
      }
    })
    return items ? `<${tag}>${items}</${tag}>` : ''
  }

  const block = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child instanceof HTMLElement && opts.atom?.(child) == null) {
        const tag = child.tagName
        if (SKIP.has(tag) || child.dataset.sentinel !== undefined) return
        if (tag === 'UL' || tag === 'OL') {
          flush()
          const list = listOf(child)
          if (list) blocks.push(list)
          return
        }
        if (BLOCK.has(tag) || tag === 'LI') {
          flush()
          // A block holding blocks (a pasted <div><p>…</p></div>) is walked as blocks.
          const hasBlocks = [...child.children].some((c) => BLOCK.has(c.tagName) || c.tagName === 'UL' || c.tagName === 'OL')
          if (hasBlocks) block(child)
          else {
            line = inlineOf(child)
            flush(true)
          }
          return
        }
        if (tag === 'BR') {
          line += '<br>'
          return
        }
      }
      line += inlineNode(child)
    })
  }

  if (inline) return sanitizeRichText(inlineOf(root).replace(/\s+/g, ' ').trim(), { inline: true })
  block(root)
  flush()
  // Drop blank paragraphs at the start and end (Enter at the end of the text).
  while (blocks[0] === '<p><br></p>') blocks.shift()
  while (blocks[blocks.length - 1] === '<p><br></p>') blocks.pop()
  return sanitizeRichText(blocks.join(''))
}

/** Pasted HTML → canonical HTML, parsed inertly (DOMParser runs no scripts and loads nothing). */
export function canonicalFromPastedHtml(html: string, opts: SerializeOptions = {}): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return serializeRichText(doc.body, opts)
}

/** Formatting commands of the toolbar (document.execCommand names). */
export type RichCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList'

export interface RichState {
  bold: boolean
  italic: boolean
  underline: boolean
  strikeThrough: boolean
  insertUnorderedList: boolean
  insertOrderedList: boolean
  /** The link the caret is in, if any. */
  link: HTMLAnchorElement | null
}

export const EMPTY_STATE: RichState = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  insertUnorderedList: false,
  insertOrderedList: false,
  link: null,
}

function queryState(cmd: string): boolean {
  try {
    return document.queryCommandState(cmd)
  } catch {
    return false
  }
}

/** Which formats apply at the caret inside `editor` (EMPTY_STATE when the caret is elsewhere). */
export function readState(editor: HTMLElement): RichState {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return EMPTY_STATE
  const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
  const inEditor = (selector: string) => {
    const el = anchor?.closest(selector);
    return el && editor.contains(el) ? el : null;
  };
  const link = inEditor('a')
  // Underline and lists from the elements themselves: browsers report a link's underline as
  // "underline", and list state can lag after a list is left.
  const list = inEditor('ul, ol')
  return {
    bold: queryState('bold'),
    italic: queryState('italic'),
    underline: !!inEditor('u') || (!link && queryState('underline')),
    strikeThrough: queryState('strikeThrough'),
    insertUnorderedList: list?.tagName === 'UL',
    insertOrderedList: list?.tagName === 'OL',
    link: link as HTMLAnchorElement | null,
  }
}

/** New lines become <p> (not <div>) and marks become tags (not style=""): call when an editor gains focus. */
export function prepareEditing(): void {
  try {
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand('defaultParagraphSeparator', false, 'p')
  } catch {
    // Older browsers: the defaults are fine (the serializer handles <div> and <b>).
  }
}

/** Runs a formatting command on the selection in `editor` (the browser's own editing, so undo works). */
export function runCommand(editor: HTMLElement, cmd: RichCommand | 'unlink' | 'removeFormat' | 'createLink' | 'insertHTML' | 'insertText', value?: string): void {
  if (document.activeElement !== editor) editor.focus()
  prepareEditing()
  document.execCommand(cmd, false, value)
}

/** The selection inside `editor`, to put back after a dialog took focus. */
export function saveRange(editor: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  return editor.contains(r.commonAncestorContainer) ? r.cloneRange() : null
}

export function restoreRange(editor: HTMLElement, range: Range | null): void {
  editor.focus()
  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  if (range && editor.contains(range.commonAncestorContainer)) sel.addRange(range)
  else {
    const end = document.createRange()
    end.selectNodeContents(editor)
    end.collapse(false)
    sel.addRange(end)
  }
}

/**
 * Adds, changes or removes the link at `range`. With no selected text, the address itself is
 * inserted as the link text. `href` must come from safeLinkHref.
 */
export function applyLink(editor: HTMLElement, range: Range | null, current: HTMLAnchorElement | null, href: string | null): void {
  restoreRange(editor, range)
  const sel = window.getSelection()
  if (current && editor.contains(current)) {
    const r = document.createRange()
    r.selectNodeContents(current)
    sel?.removeAllRanges()
    sel?.addRange(r)
    if (!href) {
      runCommand(editor, 'unlink')
      return
    }
    current.setAttribute('href', href)
    r.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(r)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  if (!href) return
  if (!sel || sel.isCollapsed) {
    const text = href.replace(/^(mailto:|tel:)/, '')
    runCommand(editor, 'insertHTML', `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>&nbsp;`)
  } else {
    runCommand(editor, 'createLink', href)
  }
}

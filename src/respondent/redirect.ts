/** The parts of `window` the redirect uses (a fake in tests). */
export interface RedirectWindow {
  location: { assign(url: string): void }
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  top: { location: { href: string } } | null
  /** Where the no-referrer policy goes before a redirect that carries answers (absent in tests). */
  document?: { head: { appendChild(node: unknown): unknown }; createElement(tag: 'meta'): { name: string; content: string } }
}

/**
 * Answers in the link: the navigation sends no `Referer` (Referrer-Policy: no-referrer for this
 * page from now on), so the answers' page isn't named to anyone the next page loads from.
 */
function noReferrer(win: RedirectWindow): void {
  const doc = win.document
  if (!doc) return
  const meta = doc.createElement('meta')
  meta.name = 'referrer'
  meta.content = 'no-referrer'
  doc.head.appendChild(meta)
}

/**
 * The redirect URL without the answers appended as query parameters (keyed by field id), or
 * null when it carries none.
 */
export function withoutAnswers(url: string, fieldIds: readonly string[]): string | null {
  const u = new URL(url)
  const ids = fieldIds.filter((id) => u.searchParams.has(id))
  if (!ids.length) return null
  for (const id of ids) u.searchParams.delete(id)
  return u.toString()
}

/**
 * After submit: a top-level page navigates. An embedded form is framed by a page we don't know
 * (any site may frame /f/*), so whatever it posts to the parent goes to '*' and must not carry
 * answers. With answers in the URL, the iframe navigates the top window itself; the submit click
 * is the user activation browsers require for that. If the browser refuses (a sandboxed frame),
 * it falls back to embed.js with the bare URL. Without answers, embed.js navigates as before.
 * An embedded form shows its end screen meanwhile.
 */
export function redirectAfterSubmit(url: string, fieldIds: readonly string[], embedded: boolean, win: RedirectWindow = window): void {
  if (!/^https?:\/\//i.test(url)) return
  if (withoutAnswers(url, fieldIds) !== null) noReferrer(win)
  if (!embedded || win.parent === (win as unknown)) {
    win.location.assign(url)
    return
  }
  const bare = withoutAnswers(url, fieldIds)
  if (bare && win.top) {
    try {
      win.top.location.href = url
      return
    } catch {
      // Top navigation blocked: send the bare URL instead.
    }
  }
  win.parent.postMessage({ type: 'intelform:redirect', url: bare ?? url }, '*')
}

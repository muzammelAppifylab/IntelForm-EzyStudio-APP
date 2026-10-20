import type { PublicFormResponse } from '../../shared/api-public'
import { payloadForSlug } from './load'

/**
 * Production HTML for /f/:slug: the respondent shell (dist/form.html) with the form JSON
 * inlined as <script type="application/json" id="__FORM__">, so the form renders without a
 * second round trip (docs/research/03-respondent.md "Performance budget"). Also fills in
 * <html lang>, <title>, the description, robots and Open Graph tags.
 *
 * A JSON data block is not executed, so it needs no CSP hash.
 */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** JSON that can sit inside <script>: no "</script", no HTML comment openers, no line separators. */
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function injectForm(shell: string, payload: PublicFormResponse | null): string {
  let html = shell
  const head: string[] = []
  if (payload && payload.status !== 'moved') {
    const s = payload.settings
    const title = s.seoTitle || payload.title
    // Replacer functions, never replacement strings: creator text may contain `$&`, `$'`…
    html = html.replace(/<html lang="[^"]*"/, () => `<html lang="${esc(payload.lang)}"`)
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    if (s.seoDescription) head.push(`<meta name="description" content="${esc(s.seoDescription)}">`)
    if (s.noindex) head.push('<meta name="robots" content="noindex, nofollow">')
    head.push(`<meta property="og:title" content="${esc(title)}">`)
    if (s.seoDescription) head.push(`<meta property="og:description" content="${esc(s.seoDescription)}">`)
    if (s.ogImage) head.push(`<meta property="og:image" content="${esc(s.ogImage)}">`)
  }
  head.push(`<script type="application/json" id="__FORM__">${safeJson(payload ?? { status: 'missing' })}</script>`)
  return html.replace('</head>', () => `${head.join('\n')}\n</head>`)
}

/** The page for a slug and its HTTP status (404 for a draft or unknown form). */
export async function renderFormPage(shell: string, slug: string): Promise<{ html: string; status: 200 | 404; noindex: boolean }> {
  const payload = await payloadForSlug(slug).catch(() => null)
  return {
    html: injectForm(shell, payload),
    status: payload ? 200 : 404,
    noindex: !payload || payload.status === 'moved' || payload.settings.noindex,
  }
}

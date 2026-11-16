/**
 * Link stripping for the respondent confirmation email (legacy server/respondent/notify.ts).
 *
 * The confirmation goes to an address the respondent typed, with their answers piped into the
 * form owner's text. Without this, anyone could make the form send a link of their choosing to
 * any inbox. Every URL, bare domain ("evil.com/login", "www.evil.com"), IP address and
 * mailto:/tel: link is removed from the ANSWERS; a plain email address stays ("We'll reply to
 * {f_email}"). The owner's own subject and body are left alone.
 */

// What a mail client may turn into a link. Dots include the ideographic and full-width forms
// that browsers read as dots in host names.
const DOT = String.raw`[.。．｡]`
const LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`
const HOST = String.raw`${LABEL}(?:${DOT}${LABEL})*${DOT}(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})`
const IPV4 = String.raw`\d{1,3}(?:${DOT}\d{1,3}){3}`
/** A port, path, query or fragment after a host. */
const REST = String.raw`(?:[:/?#\\]\S*)?`
const LINK_RE = new RegExp(
  [
    // A plain email address (nothing link-like after it) is kept.
    String.raw`(?<email>(?<![\p{L}\p{N}._%+\-])[\p{L}\p{N}._%+\-]+@${HOST}(?!${DOT}?[\p{L}\p{N}/?#:\\@\-]))`,
    // Any scheme://…, and the schemes that link without slashes.
    String.raw`\b[a-z][a-z0-9+.\-]{0,30}:\/\/\S*`,
    String.raw`\b(?:mailto|tel|sms|callto|facetime|javascript|vbscript|data|file|ftp|news|nntp|irc|xmpp|sip|skype|whatsapp|tg|magnet):\S+`,
    String.raw`\bwww\d{0,3}${DOT}\S+`,
    String.raw`\[[0-9a-f:.]*:[0-9a-f:.]*\]${REST}`,
    String.raw`(?<![\p{L}\p{N}.\-])${IPV4}(?!\p{N})${REST}`,
    String.raw`(?<![\p{L}\p{N}._%+\-])${HOST}(?![\p{L}\p{N}\-])${REST}`,
  ].join('|'),
  'giu',
)
/** Invisible characters that could hide a link from the patterns above (zero-width, bidi controls, soft hyphen). */
const INVISIBLE_RE = /[\u00ad\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** One answer with everything link-like removed; a plain email address stays. */
export function stripLinks(text: string): string {
  return text
    .replace(INVISIBLE_RE, '')
    .replace(LINK_RE, (match: string, ...rest: unknown[]) => ((rest.at(-1) as { email?: string }).email ? match : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Answers as the confirmation email may pipe them: every string through `stripLinks`. */
export function withoutLinks(v: unknown): unknown {
  if (typeof v === 'string') return stripLinks(v)
  if (Array.isArray(v)) return v.map(withoutLinks)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutLinks(x)]))
  return v
}

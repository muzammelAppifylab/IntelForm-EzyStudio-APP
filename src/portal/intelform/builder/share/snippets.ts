/**
 * The Share tab's pure parts: the public link, the inline and popup embed snippets, and the
 * QR code's caption. No DOM here, so they are unit tested (tests/intelform/builder-share.test.ts).
 *
 * The public form lives at `/f/<slug>/` (src/pages/f); `/embed.js` (public/embed.js) sizes inline
 * frames and opens popups. The snippets are pasted into OTHER sites, so they carry their own
 * inline styles: that is the host page's markup, not ours (our CSP doesn't apply there).
 */

/** The form's public link. Same shape as forms/format.ts `publicFormUrl`. */
export function formUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/f/${encodeURIComponent(slug)}/`;
}

/** The link without the scheme, for a printed QR code's caption. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

const ESCAPES: Record<string, string> = {'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'};

/** Escapes text for an HTML attribute or element body. */
export function escapeHtml(value: string): string {
  return value.replace(/[<>&"]/g, c => ESCAPES[c]!);
}

export interface EmbedOptions {
  width: 'full' | 'fixed';
  /** Typed pixel width (text, as in the input); 240 minimum, 640 when empty. */
  px: string;
  /** Typed starting height; 200 minimum, 600 when empty. */
  height: string;
  transparent: boolean;
  hideTitle: boolean;
}

export const DEFAULT_EMBED: EmbedOptions = {width: 'full', px: '640', height: '600', transparent: false, hideTitle: false};

function pixels(text: string, min: number, fallback: number): number {
  const n = Math.round(Number(text));
  return Math.max(min, Number.isFinite(n) && n > 0 ? n : fallback);
}

/** The inline iframe (+ embed.js, which grows the frame to the form's height). */
export function embedSnippet(origin: string, slug: string, title: string, opts: EmbedOptions): string {
  const params = new URLSearchParams({embed: '1'});
  if (opts.transparent) params.set('transparent', '1');
  if (opts.hideTitle) params.set('hideTitle', '1');
  const w = opts.width === 'full' ? '100%' : `${pixels(opts.px, 240, 640)}px`;
  const h = `${pixels(opts.height, 200, 600)}px`;
  const base = origin.replace(/\/+$/, '');
  return `<iframe data-intelform src="${formUrl(base, slug)}?${params}" title="${escapeHtml(title)}" loading="lazy" style="width:${w};max-width:100%;height:${h};border:0"></iframe>
<script src="${base}/embed.js" async></script>`;
}

export const DEFAULT_POPUP_LABEL = 'Take the survey';

/** A button on the host page that opens the form in embed.js's dialog. */
export function popupSnippet(origin: string, slug: string, opts: {label: string; color: string; textColor: string}): string {
  const base = origin.replace(/\/+$/, '');
  const label = escapeHtml(opts.label.trim() || 'Open form');
  const bg = safeHex(opts.color, '#211D2A');
  const fg = safeHex(opts.textColor, '#FFFFFF');
  return `<button type="button" data-intelform-popup="${escapeHtml(slug)}" data-color="${bg}" style="background:${bg};color:${fg};border:0;border-radius:8px;padding:12px 20px;font:600 16px system-ui,sans-serif;cursor:pointer">${label}</button>
<script src="${base}/embed.js" async></script>`;
}

/** Only a `#RRGGBB` colour goes into a snippet (it lands in a style attribute). */
export function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

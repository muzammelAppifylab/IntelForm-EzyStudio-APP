/**
 * Embedding the public form (`/f/<slug>/`) in another site, through public/embed.js:
 *
 *   ?embed=1 (any value but "popup")  inline iframe; the form posts its height to the parent
 *   ?embed=popup                      inside embed.js's dialog; Escape asks the parent to close
 *   &transparent=1                    no form background (the host page shows through)
 *   &hideTitle=1                      the all-at-once title is visually hidden
 *
 * Messages to the parent go to '*' (the host is unknown) and carry only a height, "close" or a
 * redirect URL without answers (redirect.ts); embed.js accepts them only from its own frames.
 */
export interface EmbedOptions {
  embed: 'inline' | 'popup' | null;
  transparent: boolean;
  hideTitle: boolean;
}

export function embedOptions(search: string | URLSearchParams): EmbedOptions {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const e = q.get('embed');
  return {
    embed: e === 'popup' ? 'popup' : e ? 'inline' : null,
    transparent: q.get('transparent') === '1',
    hideTitle: q.get('hideTitle') === '1',
  };
}

/** The query to keep when the page redirects (an old slug → the current one): embed options only. */
export function embedQuery(opts: EmbedOptions): string {
  const q = new URLSearchParams();
  if (opts.embed) q.set('embed', opts.embed === 'popup' ? 'popup' : '1');
  if (opts.transparent) q.set('transparent', '1');
  if (opts.hideTitle) q.set('hideTitle', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Message types the form posts to its parent frame (public/embed.js handles them). */
export const EMBED_MESSAGES = {
  resize: 'intelform:resize',
  close: 'intelform:close',
  redirect: 'intelform:redirect',
} as const;

import {minutesLabel, paragraphs, type PublicFormCard} from '../../lib/intelform/api-front';
import {siteFetch} from '../../platform/browser';
import {formHref} from '../../server/intelform/public-site/common';

/**
 * BROWSER: small helpers for the public site's static pages (/forms/, /about/, /privacy/,
 * /terms/). Everything from an answer goes in with `textContent`: nothing is parsed as HTML.
 */

/** A Site API read, or null on any failure (the page shows its error state). */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await siteFetch(path, {headers: {accept: 'application/json'}, signal});
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Settings, Public site, "Let search engines index the site" is off: keep this page out of search.
 * A static page is one file for everyone, so the tag is added here; the home page (rendered per
 * visit) sends it from the server.
 */
export function applyIndexing(indexing: boolean): void {
  const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"][data-site-indexing]');
  if (indexing) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const meta = document.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex';
  meta.dataset.siteIndexing = '1';
  document.head.append(meta);
}

/** Creator text as paragraphs (blank lines) and line breaks. Always text, never HTML. */
export function renderPlainText(container: HTMLElement, text: string): void {
  container.replaceChildren(
    ...paragraphs(text).map(lines => {
      const p = document.createElement('p');
      lines.forEach((line, i) => {
        if (i > 0) p.append(document.createElement('br'));
        p.append(document.createTextNode(line));
      });
      return p;
    })
  );
}

/** Fills a copy of the FormCard template (src/components/public-site/FormCard.astro). */
export function fillFormCard(row: ParentNode, form: PublicFormCard, index: number): void {
  const part = <T extends HTMLElement = HTMLElement>(name: string) => row.querySelector<T>(`[data-${name}]`)!;
  part('number').textContent = String(index + 1).padStart(2, '0');
  const minutes = minutesLabel(form.minutes);
  part('minutes-chip').hidden = !minutes;
  part('minutes').textContent = minutes ?? '';
  part('title').textContent = form.title;
  const description = part('description');
  description.textContent = form.description;
  description.hidden = !form.description;
  const link = part<HTMLAnchorElement>('href');
  link.href = formHref(form.slug);
  link.setAttribute('aria-label', `Open ${form.title}`);
}

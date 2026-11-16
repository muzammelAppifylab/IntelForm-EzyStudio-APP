import type {PublicFormCard} from '../../../lib/intelform/api-front';

/**
 * The public site's light, import-free pieces: shared by the Site API (shape.ts re-exports them)
 * and the static pages' browser scripts, which must stay small (no zod, no settings code).
 */

/** The public link of a form (the respondent page `/f/[slug]`; public page URLs end with `/`). */
export function formHref(slug: string): string {
  return `/f/${encodeURIComponent(slug)}/`;
}

/** Cards on the home page; the rest are on /forms/. */
export const HOME_FORMS = 6;
/** Cards per page of /forms/ (the list page's "More forms"). */
export const FORMS_PAGE_SIZE = 24;
/** At most this many forms are listed on the public site (legacy limit). */
export const LISTED_FORMS_MAX = 200;
/** A search on /forms/ is at most this long. */
export const SEARCH_MAX = 80;

/** GET /site-api/public-site/forms: one page of the listed forms (the /forms/ list page). */
export interface PublicFormsPage {
  forms: PublicFormCard[];
  /** The slug to pass as `after` for the next page, or null on the last one. */
  next: string | null;
  /** Every listed open form, without the search (for "3 open forms"). */
  total: number;
  /** Settings → Public site: let search engines index the site's pages. */
  indexing: boolean;
}

/** "3 open forms. Pick one to get started." (the /forms/ intro). */
export function formsCountText(total: number): string {
  if (total === 0) return 'Nothing is open right now. Check back soon.';
  return `${total} open ${total === 1 ? 'form' : 'forms'}. Pick one to get started.`;
}

/**
 * The site's own words: navigation, home, forms and legal page copy.
 *
 * Edit freely. The site's NAME and LOGO are not here: they come from the
 * platform (`GET /site-api/site`), so a rename in the dashboard shows
 * up without a Publish. Use `{name}` in any string below for the site name.
 *
 * What changes without a Publish comes from the dashboard: the forms listed on
 * the site (each form's Share tab, "Show on the homepage"), the contact email,
 * search and sharing, and the Privacy and Terms texts (Settings, Public site).
 */

/** Search and social basics. The NAME comes from the platform (above). */
export const SITE = {
  /** One sentence: the meta description of pages that have none of their own. Use `{name}`. */
  description: 'Forms from {name}.',
  /** `en`, `fr`, … : the page language (screen readers, search engines). */
  lang: 'en',
  /**
   * The address search engines should treat as THE address (canonical URLs,
   * sitemap, social cards): set it to the custom domain once the owner has one
   * (`https://www.example.com`, no trailing slash). Empty = the address
   * The platform gives the site (`SITE_URL`, src/lib/seo.ts).
   */
  url: '',
};

export interface NavItem {
  label: string;
  href: string;
  /**
   * `false` for a page rendered on every visit (SSR): it is
   * private (`no-store`), so fetching it ahead would be wasted. Every other
   * item is prerendered and prefetched as soon as the nav is on screen.
   */
  prefetch?: false;
}

/**
 * Top navigation. Empty on purpose: the public site is a quiet front desk for the forms the owner
 * shares, not a site to browse, so the header carries only the brand (and Dashboard for a
 * signed-in visitor). Every href added here is a page of THIS site, as a plain link.
 */
export const NAV: NavItem[] = [];

/**
 * The home page (`src/pages/index.astro`): what someone sees who lands on the root address,
 * usually from a shared or embedded form. It confirms whose forms these are and stops there:
 * nothing here asks anyone to fill in more. `{name}`: the site name.
 */
export const HOME = {
  /** Under the name when no form is listed (each form's Share tab, "Show on the homepage"). */
  byLink: 'Forms from {name} are shared by link. If you were sent one, open that link to get started.',
  /** Above the list when the owner lists forms on the homepage. */
  listed: 'If you were sent a link to a form, use that link. The forms below are open to anyone.',
  /** The list's heading, for screen readers and the outline. */
  formsHeading: 'Open forms',
  /** More forms listed than the home page shows. `{count}`: how many. */
  seeAll: 'All {count} forms',
  /** With a contact email (Settings, Public site). */
  contact: 'Questions?',
  error: 'This page didn’t load. Refresh to try again.',
  /** The dashboard picture of the template's original home page (`src/components/home/HeroVisual.astro`). Unused by IntelForm. */
  visual: {
    nav: ['Overview', 'Forms', 'Responses', 'Contacts', 'Settings'],
    title: 'Overview',
    stats: [
      {label: 'Forms', value: '4', trend: '+1 this week'},
      {label: 'Responses', value: '48', trend: '+6 this week'},
      {label: 'Contacts', value: '31', trend: '+5 this week'},
    ],
    chart: 'Responses, last 30 days',
    rows: [
      {name: 'Contact us', status: 'Live', tone: 'success'},
      {name: 'How are we doing?', status: 'Live', tone: 'info'},
      {name: 'Event sign-up', status: 'Draft', tone: 'warning'},
    ],
  },
};

/** /forms/: every listed open form, searchable. */
export const FORMS = {
  title: 'All forms',
  description: 'Forms from {name} that are open to anyone.',
  search: 'Search forms',
  /** `{query}`: the search. */
  noMatch: 'No forms match this search. Try another word.',
  error: 'The forms didn’t load.',
  more: 'More forms',
};

/** Privacy and Terms: their texts are written in Settings, Public site. */
export const LEGAL = {
  eyebrow: 'Legal',
  empty: 'This page hasn’t been written yet.',
  error: 'This page didn’t load.',
  privacy: {title: 'Privacy policy', description: 'How {name} uses the answers you send.'},
  terms: {title: 'Terms', description: 'The terms for using the forms of {name}.'},
};

/** Fill `{name}` with the site's name. */
export function withName(text: string, name: string): string {
  return text.replaceAll('{name}', name);
}

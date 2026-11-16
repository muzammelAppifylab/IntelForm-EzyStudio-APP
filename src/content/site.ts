/**
 * The site's own words: navigation, home, forms, about and legal page copy.
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
  description: 'Bookings, questions and feedback for {name}, all in one place.',
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
 * Top navigation. Every href is a page of THIS site (`/`, `/forms/`,
 * `/about/`, `/dashboard`, `/account/…`): plain links. The home page is rendered per
 * visit (its forms come from the database) but reads no visitor and may be kept a minute, so a
 * prefetch of it is used.
 */
export const NAV: NavItem[] = [
  {label: 'Home', href: '/'},
  {label: 'Forms', href: '/forms/'},
  {label: 'About', href: '/about/'},
];

/**
 * The home page, top to bottom (`src/pages/index.astro`): the creator's public
 * forms hub. Rewrite every word for the business. No invented reviews or numbers.
 */
export const HOME = {
  hero: {
    /** The headline is the app name (Settings, General); this is the text under it. */
    body: 'Bookings, questions and feedback, all in one place. Pick a form and you’re done in a few minutes.',
    /** Several forms: jump to the list. One form: its own title starts it. */
    seeForms: 'See the forms',
    about: 'About',
  },
  /** The decorative form preview next to the headline (hidden from screen readers). */
  preview: {
    progress: 'Question 2 of 6',
    question: 'How was your visit?',
    options: ['Great, thank you', 'Good, with a few notes', 'Not quite right'],
    time: 'About 2 min',
    button: 'Continue',
  },
  forms: {
    eyebrow: 'Open now',
    title: 'Forms',
    /** `{count}`: how many forms are open. */
    seeAll: 'See all {count} forms',
    empty: 'Nothing is open right now. Check back soon.',
    /** With a contact email (Settings, Public site). `{email}`: the address. */
    emptyWithEmail: 'Nothing is open right now. Questions? Email {email}.',
  },
  goodToKnow: {
    label: 'Good to know',
    noAccount: 'No account needed',
    anyDevice: 'Works on any device',
    privacy: 'How your answers are used',
  },
  how: {
    eyebrow: 'How it works',
    title: 'Three steps, a few minutes',
    steps: [
      {title: 'Pick a form', body: 'Open the one that fits, whether it’s a booking, a question or feedback.'},
      {title: 'Answer a few questions', body: 'One question at a time, with the time it takes shown up front.'},
      {title: 'We read and reply', body: 'A person reads every answer and gets back to you when it needs a reply.'},
    ],
  },
  about: {
    eyebrow: 'About',
    title: 'Who you’re talking to',
    body: '{name} uses these forms to hear from clients and anyone curious about the work. Every answer is read by a person, and you’ll hear back if it needs a reply.',
    link: 'More about {name}',
  },
  contact: {
    title: 'Rather write?',
    body: 'Questions about a form, or something else entirely.',
  },
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
  description: 'Every form {name} has open right now: bookings, questions and feedback.',
  search: 'Search forms',
  /** `{query}`: the search. */
  noMatch: 'No forms match this search. Try another word.',
  error: 'The forms didn’t load.',
  more: 'More forms',
};

export const ABOUT = {
  title: 'About {name}',
  lede: 'Who’s asking, and why.',
  story: [
    '{name} would rather ask than guess. These forms are how clients, collaborators and anyone curious about the work get in touch.',
    'Whether you’re booking a slot, asking a question or saying how it went, a few minutes of your time helps get it right.',
  ],
  /** `{email}`: the contact email (Settings, Public site); hidden when there is none. */
  write: 'Rather write? Email',
  values: {
    eyebrow: 'How we work',
    title: 'What you can expect',
    items: [
      {title: 'Short by design', body: 'We only ask what we need, and each form says up front about how long it takes.'},
      {title: 'Read by a person', body: 'Your answers are read, not filed away, and you’ll hear back when they need a reply.'},
      {title: 'Your data, kept small', body: 'We ask only for what we need, and use it only to follow up on what you sent.'},
    ],
  },
  cta: {
    ready: 'Ready when you are.',
    none: 'New forms land on the home page.',
    button: 'Browse forms',
  },
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

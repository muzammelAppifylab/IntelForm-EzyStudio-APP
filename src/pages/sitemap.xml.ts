import type {APIRoute} from 'astro';

import {postHref, publishedPosts} from '../lib/posts';
import {absoluteUrl, xmlEscape as escape} from '../lib/seo';
import {backend, read} from '../server/backend';
import {type PublicSitemap, sitemapPaths} from '../server/intelform/public-site/shape';

/**
 * `/sitemap.xml`, rendered ON REQUEST and cached for an hour: the public pages in
 * `src/pages/` (found automatically), every blog post and the open public forms (`/f/<slug>`)
 * that allow search engines (their Settings tab's "Hide from search engines" off), from
 * `GET /site-api/public-site/sitemap` (one bounded query).
 *
 * The public site's own pages (home, Forms, Privacy, Terms) are listed only while
 * Settings, Public site lets search engines index them, as their `noindex` says; Privacy and
 * Terms only once they have a text.
 *
 * Never listed: sign-in pages, the dashboard, the API, the 404 and 500 pages. A new public
 * dynamic route (`[slug].astro`) is not found automatically: add its URLs
 * here, as posts and forms are. A page with `<Base noindex>` goes in EXCLUDE.
 */
export const prerender = false;

const EXCLUDE = new Set(['/404/', '/500/', '/checkout/', '/thanks/']);
const PRIVATE = /^\/(account|portal|site-api|dashboard)(\/|$)/;
/** `./privacy.astro` → `/privacy/`, `./blog/index.astro` → `/blog/` (every page URL ends with `/`, like the canonical). */
const pagePaths = Object.keys(import.meta.glob('./**/*.astro'))
  .filter(file => !file.includes('['))
  .map(file => `/${file.slice(2).replace(/\.astro$/, '').replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/'))
  .filter(path => !PRIVATE.test(path) && !EXCLUDE.has(path))
  .sort();

export const GET: APIRoute = async ({request}) => {
  const [posts, data] = await Promise.all([
    publishedPosts(),
    read<PublicSitemap>(backend(request)['public-site'].sitemap.$get()),
  ]);
  const entries: {path: string; lastmod?: string}[] = [
    ...sitemapPaths(pagePaths, data),
    ...posts.map(post => ({path: postHref(post), lastmod: (post.data.updatedAt ?? post.data.publishedAt).toISOString()})),
  ];
  const urls = entries.flatMap(({path, lastmod}) => {
    const loc = absoluteUrl(path);
    return loc ? [`  <url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`] : [];
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // The same for everyone (no cookies read): browsers and caches may keep it an hour. When the
      // database could not be read, the forms are missing: keep that answer only a few minutes.
      'Cache-Control': data ? 'public, max-age=3600' : 'public, max-age=300',
    },
  });
};

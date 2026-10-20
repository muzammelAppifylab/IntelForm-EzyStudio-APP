import { Hono, type Context } from 'hono'
import { LEGAL_KINDS, LEGAL_TITLE, type LegalKind, type PublicAppInfo, type PublicHome, type PublicLegal } from '../../shared/api-front'
import { emailEnabled } from '../lib/email'
import { ApiError } from '../lib/errors'
import { clientIp, ipKeyFor } from '../lib/ip'
import { rateLimit } from '../lib/rate-limit'
import { getSetting } from '../lib/settings'
import { loadFrontPage, publicFormCards } from './front-page'

/** Routes respondents and visitors use. No session; everything here is safe to show anyone. */
export const publicRoutes = new Hono()

/** Generous per-IP limit for the page data routes (a visitor loads one or two per page view). */
async function limitVisitor(c: Context) {
  const ip = clientIp(c)
  if (ip) await rateLimit(`public-page:ip:${ipKeyFor(ip)}`, 300, 60)
}

publicRoutes.get('/app', async (c) => {
  const [{ appName, logoUrl, faviconUrl, dateFormat }, { accentColor, defaultMode }, email] = await Promise.all([
    getSetting('general'),
    getSetting('branding'),
    emailEnabled(),
  ])
  return c.json<PublicAppInfo>({ appName, logoUrl, emailEnabled: email, faviconUrl, accentColor, defaultMode, dateFormat })
})

/** Front page content plus the featured Live forms, or `{ enabled: false }`. */
publicRoutes.get('/home', async (c) => {
  // Edits and closed forms must show at once; the browser revalidates every visit.
  c.header('Cache-Control', 'no-cache')
  await limitVisitor(c)
  const { content, featuredOrder } = await loadFrontPage()
  if (!content.enabled) return c.json<PublicHome>({ enabled: false })
  const [{ appName, logoUrl }, forms] = await Promise.all([getSetting('general'), publicFormCards(featuredOrder)])
  return c.json<PublicHome>({
    enabled: true,
    appName,
    logoUrl,
    hero: content.hero,
    about: content.about.enabled && (content.about.title || content.about.text) ? content.about : null,
    contact: content.contact.enabled && (content.contact.email || content.contact.phone || content.contact.address) ? content.contact : null,
    seo: content.seo,
    themeId: content.themeId,
    forms,
    hasPrivacy: !!content.privacy,
    hasTerms: !!content.terms,
  })
})

/** Privacy policy and terms texts (plain text). */
publicRoutes.get('/legal/:kind', async (c) => {
  const kind = c.req.param('kind') as LegalKind
  if (!LEGAL_KINDS.includes(kind)) throw new ApiError(404, 'not_found', 'No such page')
  c.header('Cache-Control', 'no-cache')
  await limitVisitor(c)
  const [{ content }, { appName }] = await Promise.all([loadFrontPage(), getSetting('general')])
  return c.json<PublicLegal>({ kind, title: LEGAL_TITLE[kind], appName, text: content[kind] })
})

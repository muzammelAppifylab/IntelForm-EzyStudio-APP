import { Hono, type Context } from 'hono'
import { LEGAL_KINDS, LEGAL_TITLE, type LegalKind, type PublicAppInfo, type PublicHome, type PublicLegal } from '../../shared/api-front'
import { emailEnabled } from '../lib/email'
import { ApiError } from '../lib/errors'
import { clientIp, ipKeyFor } from '../lib/ip'
import { rateLimit } from '../lib/rate-limit'
import { getSetting } from '../lib/settings'
import { publicFormCards } from '../lib/public-site'

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

/** What every public site page needs: app name, logo, listed forms, search and legal flags. */
publicRoutes.get('/home', async (c) => {
  // Edits and closed forms must show at once; the browser revalidates every visit.
  c.header('Cache-Control', 'no-cache')
  await limitVisitor(c)
  const [{ appName, logoUrl }, site, legal, forms] = await Promise.all([getSetting('general'), getSetting('site'), getSetting('legal'), publicFormCards()])
  return c.json<PublicHome>({
    appName,
    logoUrl,
    forms,
    description: site.description,
    ogImage: site.ogImage,
    contactEmail: site.contactEmail,
    indexing: site.indexing,
    hasPrivacy: !!legal.privacy,
    hasTerms: !!legal.terms,
  })
})

/** Privacy policy and terms texts (plain text, Settings → Public site). */
publicRoutes.get('/legal/:kind', async (c) => {
  const kind = c.req.param('kind') as LegalKind
  if (!LEGAL_KINDS.includes(kind)) throw new ApiError(404, 'not_found', 'No such page')
  c.header('Cache-Control', 'no-cache')
  await limitVisitor(c)
  const [legal, { appName }] = await Promise.all([getSetting('legal'), getSetting('general')])
  return c.json<PublicLegal>({ kind, title: LEGAL_TITLE[kind], appName, text: legal[kind] })
})

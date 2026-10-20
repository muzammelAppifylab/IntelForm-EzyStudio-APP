import type { FeaturedFormView, FrontPageContent, PublicHomeOn } from '@shared/api-front'

/** What the public page would show for the unsaved editor state. */
export function previewHome(content: FrontPageContent, featured: FeaturedFormView[], app: { appName: string; logoUrl: string | null }): PublicHomeOn {
  return {
    enabled: true,
    appName: app.appName,
    logoUrl: app.logoUrl,
    hero: content.hero,
    about: content.about.enabled && (content.about.title || content.about.text) ? content.about : null,
    contact: content.contact.enabled && (content.contact.email || content.contact.phone || content.contact.address) ? content.contact : null,
    seo: content.seo,
    themeId: content.themeId,
    forms: featured.filter((f) => f.isPublic).map((f) => ({ title: f.title, slug: f.slug, description: f.description, minutes: f.minutes })),
    hasPrivacy: !!content.privacy.trim(),
    hasTerms: !!content.terms.trim(),
  }
}

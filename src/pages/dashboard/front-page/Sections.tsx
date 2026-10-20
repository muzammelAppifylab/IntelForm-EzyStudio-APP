import { Check } from 'lucide-react'
import type { FrontPageContent } from '@shared/api-front'
import { THEME_PRESETS } from '@shared/form/theme'
import { Field } from '@/components/common/Field'
import { cn } from '@/components/ui/cn'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GroupCard, SwitchRow } from '@/pages/dashboard/settings/bits'
import type { Errors } from '@/pages/dashboard/settings/form-utils'
import { ImageUpload } from '@/pages/dashboard/settings/ImageUpload'

type Update = <K extends keyof FrontPageContent>(key: K, value: FrontPageContent[K]) => void

interface SectionProps {
  content: FrontPageContent
  update: Update
  errors: Errors
  readOnly: boolean
}

export function HeroSection({ content, update, errors, readOnly }: SectionProps) {
  const hero = content.hero
  const set = <K extends keyof typeof hero>(k: K, v: (typeof hero)[K]) => update('hero', { ...hero, [k]: v })
  return (
    <GroupCard title="Hero" description="The first thing visitors see: a headline, a short text, an image and an optional button." readOnly={readOnly}>
      <Field label="Headline" description="Leave empty to use the app name." error={errors['hero.headline']}>
        {(p) => <Input {...p} value={hero.headline} maxLength={120} onChange={(e) => set('headline', e.target.value)} />}
      </Field>
      <Field label="Text" description="One or two sentences. Blank lines start a new paragraph." error={errors['hero.text']}>
        {(p) => <Textarea {...p} value={hero.text} maxLength={600} rows={3} onChange={(e) => set('text', e.target.value)} />}
      </Field>
      <ImageUpload
        label="Logo or image"
        description="JPG, PNG or WebP, up to 5 MB. Shown beside the headline."
        purpose="image"
        value={hero.imageUrl}
        disabled={readOnly}
        onChange={(url) => set('imageUrl', url)}
        error={errors['hero.imageUrl']}
      />
      {hero.imageUrl && (
        <Field label="Image description" description="For screen readers. Leave empty if the image is decoration." error={errors['hero.imageAlt']}>
          {(p) => <Input {...p} value={hero.imageAlt} maxLength={200} onChange={(e) => set('imageAlt', e.target.value)} />}
        </Field>
      )}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Field label="Button label" description="Optional." error={errors['hero.buttonLabel']}>
          {(p) => <Input {...p} value={hero.buttonLabel} maxLength={40} placeholder="Visit our site" onChange={(e) => set('buttonLabel', e.target.value)} />}
        </Field>
        <Field label="Button link" error={errors['hero.buttonUrl']}>
          {(p) => (
            <Input
              {...p}
              type="url"
              value={hero.buttonUrl ?? ''}
              placeholder="https://example.com"
              onChange={(e) => set('buttonUrl', e.target.value.trim() ? e.target.value : null)}
            />
          )}
        </Field>
      </div>
    </GroupCard>
  )
}

export function AboutSection({ content, update, errors, readOnly }: SectionProps) {
  const about = content.about
  const set = <K extends keyof typeof about>(k: K, v: (typeof about)[K]) => update('about', { ...about, [k]: v })
  return (
    <GroupCard title="About" description="A short block about who you are." readOnly={readOnly}>
      <SwitchRow label="Show the About block" checked={about.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={readOnly} />
      {about.enabled && (
        <>
          <Field label="Title" error={errors['about.title']}>
            {(p) => <Input {...p} value={about.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field label="Text" description="Blank lines start a new paragraph." error={errors['about.text']}>
            {(p) => <Textarea {...p} value={about.text} maxLength={4000} rows={5} onChange={(e) => set('text', e.target.value)} />}
          </Field>
        </>
      )}
    </GroupCard>
  )
}

export function ContactSection({ content, update, errors, readOnly }: SectionProps) {
  const contact = content.contact
  const set = <K extends keyof typeof contact>(k: K, v: (typeof contact)[K]) => update('contact', { ...contact, [k]: v })
  return (
    <GroupCard title="Contact" description="How visitors can reach you. Empty fields are left out." readOnly={readOnly}>
      <SwitchRow label="Show contact details" checked={contact.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={readOnly} />
      {contact.enabled && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" error={errors['contact.email']}>
              {(p) => <Input {...p} type="email" value={contact.email} placeholder="hello@example.com" onChange={(e) => set('email', e.target.value)} />}
            </Field>
            <Field label="Phone" error={errors['contact.phone']}>
              {(p) => <Input {...p} type="tel" value={contact.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />}
            </Field>
          </div>
          <Field label="Address" error={errors['contact.address']}>
            {(p) => <Textarea {...p} value={contact.address} maxLength={500} rows={3} onChange={(e) => set('address', e.target.value)} />}
          </Field>
        </>
      )}
    </GroupCard>
  )
}

export function LookSection({ content, update, readOnly }: SectionProps) {
  return (
    <GroupCard title="Look" description="One of the form theme presets. Your logo and app name come from Settings." readOnly={readOnly}>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {THEME_PRESETS.map((p) => {
          const checked = content.themeId === p.id
          const c = p.theme.colors
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={readOnly}
              onClick={() => update('themeId', p.id)}
              className={cn(
                'focus-ring grid gap-2 rounded-lg border bg-card p-2 text-left transition-colors duration-(--duration-fast) hover:border-input disabled:cursor-not-allowed',
                checked ? 'border-option-selected-border bg-option-selected text-option-selected-foreground ring-1 ring-option-selected-border' : 'border-border',
              )}
            >
              {/* The swatch shows the preset's own colours: data, not UI styling. */}
              <span className="relative grid h-14 place-items-center rounded-md border border-border" style={{ background: c.background }}>
                <span className="h-3 w-12 rounded-full" style={{ background: c.button }} />
                {checked && (
                  <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full border-2 border-border-ink bg-primary text-primary-foreground">
                    <Check className="size-3" aria-hidden />
                  </span>
                )}
              </span>
              <span className="flex items-baseline justify-between gap-1 text-label">
                {p.name}
                <span className="text-caption text-muted-foreground">{p.mode === 'dark' ? 'Dark' : 'Light'}</span>
              </span>
            </button>
          )
        })}
      </div>
    </GroupCard>
  )
}

export function SeoSection({ content, update, errors, readOnly }: SectionProps) {
  const seo = content.seo
  const set = <K extends keyof typeof seo>(k: K, v: (typeof seo)[K]) => update('seo', { ...seo, [k]: v })
  return (
    <GroupCard title="Search and sharing" description="How the page appears in search results and when its link is shared." readOnly={readOnly}>
      <SwitchRow
        label="Let search engines index this page"
        description="Off by default. Forms keep their own setting."
        checked={seo.indexing}
        onCheckedChange={(v) => set('indexing', v)}
        disabled={readOnly}
      />
      <Field label="Page title" description="Leave empty to use the headline." error={errors['seo.title']}>
        {(p) => <Input {...p} value={seo.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />}
      </Field>
      <Field label="Description" description="About 150 characters works best." error={errors['seo.description']}>
        {(p) => <Textarea {...p} value={seo.description} maxLength={300} rows={2} onChange={(e) => set('description', e.target.value)} />}
      </Field>
      <ImageUpload
        label="Social preview image"
        description="1200 × 630 px works best. JPG, PNG or WebP, up to 5 MB."
        purpose="og"
        value={seo.ogImage}
        disabled={readOnly}
        onChange={(url) => set('ogImage', url)}
        error={errors['seo.ogImage']}
      />
    </GroupCard>
  )
}

export function LegalSection({ content, update, errors, readOnly }: SectionProps) {
  return (
    <GroupCard title="Privacy and terms" description="Linked from the footer when they have text. Plain text: blank lines start a new paragraph." readOnly={readOnly}>
      <Field label="Privacy policy" error={errors.privacy}>
        {(p) => <Textarea {...p} value={content.privacy} rows={8} onChange={(e) => update('privacy', e.target.value)} />}
      </Field>
      <Field label="Terms" error={errors.terms}>
        {(p) => <Textarea {...p} value={content.terms} rows={8} onChange={(e) => update('terms', e.target.value)} />}
      </Field>
    </GroupCard>
  )
}

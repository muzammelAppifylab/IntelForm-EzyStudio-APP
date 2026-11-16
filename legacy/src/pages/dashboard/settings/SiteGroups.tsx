import { useState } from 'react'
import { toast } from 'sonner'
import { legalSettingsInput, siteSettingsInput, type AppSettingsView } from '@shared/settings-app'
import { Field } from '@/components/common/Field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GroupCard, SwitchRow } from '@/pages/dashboard/settings/bits'
import { apiErrors, same, zodErrors, type Errors } from '@/pages/dashboard/settings/form-utils'
import { ImageUpload } from '@/pages/dashboard/settings/ImageUpload'
import { useSaveSettings } from '@/pages/dashboard/settings/queries'

/**
 * The public site's settings. Its pages and copy (home, About, Forms) are code in
 * src/pages/public; only what has to change without a deploy is here.
 */
export function SiteGroup({ view }: { view: AppSettingsView }) {
  return (
    <div className="grid gap-6">
      <SearchGroup view={view} />
      <LegalGroup view={view} />
    </div>
  )
}

function SearchGroup({ view }: { view: AppSettingsView }) {
  const [v, setV] = useState(view.site)
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }))

  function submit() {
    const r = zodErrors(siteSettingsInput, v)
    if (r.errors) return setErrors(r.errors)
    setErrors({})
    save.mutate(
      { site: r.data },
      {
        onSuccess: (next) => {
          setV(next.site)
          toast.success('Site details saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  return (
    <GroupCard
      title="Site details"
      description="How visitors reach you, and how the site appears in search results and link previews. The page title is the app name."
      onSubmit={submit}
      dirty={!same(v, view.site)}
      saving={save.isPending}
      formError={errors._form ?? errors.site}
    >
      <SwitchRow
        label="Let search engines index the public site"
        description="Off by default. Forms keep their own setting."
        checked={v.indexing}
        onCheckedChange={(on) => set('indexing', on)}
      />
      <Field label="Contact email" description="Shown on the public site so visitors can reach you. Leave empty to hide it." error={errors.contactEmail}>
        {(p) => <Input {...p} type="email" value={v.contactEmail} placeholder="hello@example.com" onChange={(e) => set('contactEmail', e.target.value)} className="sm:max-w-sm" />}
      </Field>
      <Field label="Description" description="For search results and link previews. About 150 characters works best." error={errors.description}>
        {(p) => <Textarea {...p} value={v.description} maxLength={300} rows={2} onChange={(e) => set('description', e.target.value)} />}
      </Field>
      <ImageUpload
        label="Social preview image"
        description="1200 × 630 px works best. JPG, PNG or WebP, up to 5 MB."
        purpose="og"
        value={v.ogImage}
        onChange={(url) => set('ogImage', url)}
        error={errors.ogImage}
      />
    </GroupCard>
  )
}

function LegalGroup({ view }: { view: AppSettingsView }) {
  const [v, setV] = useState(view.legal)
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()

  function submit() {
    const r = zodErrors(legalSettingsInput, v)
    if (r.errors) return setErrors(r.errors)
    setErrors({})
    save.mutate(
      { legal: r.data },
      {
        onSuccess: (next) => {
          setV(next.legal)
          toast.success('Privacy and terms saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  return (
    <GroupCard
      title="Privacy and terms"
      description="Shown at /privacy and /terms, and linked from the site footer when they have text. Plain text: blank lines start a new paragraph."
      onSubmit={submit}
      dirty={!same(v, view.legal)}
      saving={save.isPending}
      formError={errors._form ?? errors.legal}
    >
      <Field label="Privacy policy" error={errors.privacy}>
        {(p) => <Textarea {...p} value={v.privacy} rows={8} onChange={(e) => setV((o) => ({ ...o, privacy: e.target.value }))} />}
      </Field>
      <Field label="Terms" error={errors.terms}>
        {(p) => <Textarea {...p} value={v.terms} rows={8} onChange={(e) => setV((o) => ({ ...o, terms: e.target.value }))} />}
      </Field>
    </GroupCard>
  )
}

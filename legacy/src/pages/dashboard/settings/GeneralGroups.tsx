import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { SavedThemesResponse } from '@shared/api-builder'
import { THEME_PRESETS } from '@shared/form/theme'
import {
  brandingSettingsInput,
  COLOR_MODES,
  DATE_FORMATS,
  generalSettingsInput,
  type AppSettingsView,
  type ColorMode,
  type DateFormat,
} from '@shared/settings-app'
import { Field } from '@/components/common/Field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { GroupCard } from '@/pages/dashboard/settings/bits'
import { apiErrors, same, zodErrors, type Errors } from '@/pages/dashboard/settings/form-utils'
import { ImageUpload } from '@/pages/dashboard/settings/ImageUpload'
import { useSaveSettings } from '@/pages/dashboard/settings/queries'
import { TimezoneCombobox } from '@/pages/dashboard/settings/TimezoneCombobox'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Today's date in one of the app date formats, as an example in the picker. */
function formatExample(format: DateFormat, d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  switch (format) {
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`
    case 'D MMM YYYY':
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${yyyy}`
  }
}

export function GeneralGroup({ view }: { view: AppSettingsView }) {
  const [v, setV] = useState(view.general)
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }))

  function submit() {
    const r = zodErrors(generalSettingsInput, v)
    if (r.errors) return setErrors(r.errors)
    setErrors({})
    save.mutate(
      { general: r.data },
      {
        onSuccess: (next) => {
          setV(next.general)
          toast.success('General settings saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  return (
    <GroupCard
      title="General"
      description="How the app introduces itself on the login screen, the public site and in emails."
      onSubmit={submit}
      dirty={!same(v, view.general)}
      saving={save.isPending}
      formError={errors._form ?? errors.general}
    >
      <Field label="App name" description="Shown on the login screen, in the sidebar, on the public site and in emails." error={errors.appName} required>
        {(p) => <Input {...p} value={v.appName} maxLength={60} onChange={(e) => set('appName', e.target.value)} className="sm:max-w-sm" />}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <ImageUpload label="Logo" description="PNG, JPG, WebP or SVG, up to 5 MB." purpose="logo" shape="square" value={v.logoUrl} onChange={(url) => set('logoUrl', url)} error={errors.logoUrl} />
        <ImageUpload label="Favicon" description="A square image, 64 × 64 px or larger." purpose="favicon" shape="square" value={v.faviconUrl} onChange={(url) => set('faviconUrl', url)} error={errors.faviconUrl} />
      </div>
      <Field label="Default time zone" description="Used for close dates and response times." error={errors.timezone}>
        {(p) => <TimezoneCombobox {...p} value={v.timezone} onChange={(tz) => set('timezone', tz)} />}
      </Field>
      <Field label="Date format" error={errors.dateFormat}>
        {(p) => (
          <Select value={v.dateFormat} onValueChange={(f) => set('dateFormat', f as DateFormat)}>
            <SelectTrigger {...p} className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {formatExample(f)} <span className="text-muted-foreground">({f})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
    </GroupCard>
  )
}

const MODE_LABEL: Record<ColorMode, string> = { light: 'Light', dark: 'Dark', system: 'Follow the device' }
const DEFAULT_THEME = '__default'

export function BrandingGroup({ view }: { view: AppSettingsView }) {
  const [v, setV] = useState(view.branding)
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()
  const themes = useQuery({ queryKey: ['themes'], queryFn: () => api<SavedThemesResponse>('/api/themes'), retry: false })
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }))

  function submit() {
    const r = zodErrors(brandingSettingsInput, v)
    if (r.errors) return setErrors(r.errors)
    setErrors({})
    save.mutate(
      { branding: r.data },
      {
        onSuccess: (next) => {
          setV(next.branding)
          toast.success('Branding saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  return (
    <GroupCard
      title="Branding"
      description="The dashboard’s accent colour and mode, and the theme new forms start with."
      onSubmit={submit}
      dirty={!same(v, view.branding)}
      saving={save.isPending}
      formError={errors._form ?? errors.branding}
    >
      <Field label="Dashboard accent colour" description="Primary buttons and the active menu item in the dashboard. Leave empty for the default periwinkle." error={errors.accentColor}>
        {(p) => (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label="Pick the accent colour"
              value={v.accentColor ?? '#C9C0FF'}
              onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
              className="focus-ring h-(--control-md) w-12 cursor-pointer rounded-md border border-input bg-field p-1"
            />
            <Input
              {...p}
              value={v.accentColor ?? ''}
              placeholder="#C9C0FF"
              maxLength={7}
              onChange={(e) => set('accentColor', e.target.value.trim() ? e.target.value.trim() : null)}
              className="w-32 font-mono"
            />
            {v.accentColor && (
              <Button type="button" variant="ghost" size="sm" onClick={() => set('accentColor', null)}>
                Use the default
              </Button>
            )}
          </div>
        )}
      </Field>
      <Field label="Default mode" description="What a team member sees until they pick light or dark themselves." error={errors.defaultMode}>
        {(p) => (
          <Select value={v.defaultMode} onValueChange={(m) => set('defaultMode', m as ColorMode)}>
            <SelectTrigger {...p} className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLOR_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Default theme for new forms" description="Each form can still change its theme in the Design tab." error={errors.defaultThemeId}>
        {(p) => (
          <Select value={v.defaultThemeId ?? DEFAULT_THEME} onValueChange={(id) => set('defaultThemeId', id === DEFAULT_THEME ? null : id)}>
            <SelectTrigger {...p} className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Built-in themes</SelectLabel>
                <SelectItem value={DEFAULT_THEME}>IntelForm (default)</SelectItem>
                {THEME_PRESETS.slice(1).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} <span className="text-muted-foreground">({t.mode})</span>
                  </SelectItem>
                ))}
              </SelectGroup>
              {!!themes.data?.themes.length && (
                <SelectGroup>
                  <SelectLabel>Saved themes</SelectLabel>
                  {themes.data.themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        )}
      </Field>
    </GroupCard>
  )
}

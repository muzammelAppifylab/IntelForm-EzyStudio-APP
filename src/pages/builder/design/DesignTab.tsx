import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SavedTheme, SavedThemesResponse } from '@shared/api-builder'
import {
  THEME_FONTS,
  THEME_PRESETS,
  themeContrastIssues,
  type FormTheme,
  type ThemeColors,
  type ThemeFont,
  type ThemePreset,
} from '@shared/form/theme'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { cn } from '@/components/ui/cn'
import { api, errorMessage } from '@/lib/api'
import { Note, PanelSection, SegmentRow, SelectRow, TextRow } from '@/builder/controls'
import { loadThemeFont } from '@/builder/fonts'
import { ImageUpload } from '@/builder/ImageUpload'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { DeviceToggle, FormPreview, type Device } from '../PreviewDialog'

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; help: string }[] = [
  { key: 'background', label: 'Background', help: 'Page behind the form' },
  { key: 'question', label: 'Questions', help: 'Labels and descriptions' },
  { key: 'answer', label: 'Answers', help: 'Selected options, focus, progress' },
  { key: 'button', label: 'Button', help: 'Next, Submit, Start' },
  { key: 'buttonText', label: 'Button text', help: 'Text on the button' },
]

/** Design tab (PRD "Theme"): settings on the left, live preview on the right. */
export function DesignTab() {
  const theme = useBuilder((s) => s.doc.theme)
  const readOnly = useBuilder((s) => s.readOnly)
  const store = useBuilderStore()
  const [device, setDevice] = useState<Device>('desktop')
  // "Image" picked but nothing uploaded yet: show the uploader; the theme stays solid until then.
  const [wantImage, setWantImage] = useState(false)
  const [lastImage, setLastImage] = useState<string | null>(null)
  const set = (label: string, recipe: (t: FormTheme) => void, key?: string) => store.getState().commit(label, (d) => void recipe(d.theme as FormTheme), key)
  const issues = themeContrastIssues(theme)

  return (
    <div className="grid h-full grid-cols-[360px_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto border-r border-border bg-card">
        <PanelSection title="Presets" description="Picking one sets every option below. Your logo is kept.">
          <ul className="grid grid-cols-2 gap-2" aria-label="Theme presets">
            {THEME_PRESETS.map((p) => (
              <li key={p.id}>
                <PresetCard
                  preset={p}
                  active={theme.preset === p.id}
                  disabled={readOnly}
                  onPick={() => set(`Apply ${p.name} theme`, (t) => Object.assign(t, { ...structuredClone(p.theme), logo: t.logo }))}
                />
              </li>
            ))}
          </ul>
        </PanelSection>

        <PanelSection title="Colours">
          {COLOR_FIELDS.map((c) => (
            <ColorField
              key={c.key}
              label={c.label}
              help={c.help}
              value={theme.colors[c.key]}
              disabled={readOnly}
              warn={issues.some((i) => i.key === c.key)}
              onChange={(v) =>
                set(
                  'Change colour',
                  (t) => {
                    t.colors[c.key] = v
                    t.preset = null
                  },
                  `theme:color:${c.key}`,
                )
              }
            />
          ))}
          {issues.length > 0 ? (
            <div className="grid gap-2" role="status">
              {issues.map((i) => (
                <Note key={i.key} tone="warning">
                  {i.message}
                </Note>
              ))}
              <p className="text-caption text-muted-foreground">Warnings don’t stop you publishing, but some people may struggle to read the form.</p>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-success-subtle-foreground" role="status">
              <Check className="size-3.5" aria-hidden />
              Text and buttons meet WCAG AA contrast.
            </p>
          )}
        </PanelSection>

        <PanelSection title="Text">
          <FontSelect label="Font" value={theme.font} disabled={readOnly} onChange={(f) => f && set('Change font', (t) => void ((t.font = f), (t.preset = null)))} />
          <FontSelect
            label="Question font"
            value={theme.questionFont}
            allowSame
            disabled={readOnly}
            onChange={(f) => set('Change question font', (t) => void ((t.questionFont = f), (t.preset = null)))}
          />
          <SegmentRow
            label="Size"
            value={theme.fontSize}
            disabled={readOnly}
            options={[
              { value: 's', label: 'Small' },
              { value: 'm', label: 'Medium' },
              { value: 'l', label: 'Large' },
            ]}
            onChange={(v) => set('Change text size', (t) => void (t.fontSize = v))}
          />
          <SegmentRow
            label="Alignment"
            description="One-at-a-time questions and the start and end screens."
            value={theme.alignment}
            disabled={readOnly}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
            ]}
            onChange={(v) => set('Change alignment', (t) => void (t.alignment = v))}
          />
        </PanelSection>

        <PanelSection title="Background">
          <SegmentRow
            label="Type"
            value={wantImage ? 'image' : theme.background.type}
            disabled={readOnly}
            options={[
              { value: 'solid', label: 'Solid colour' },
              { value: 'image', label: 'Image' },
            ]}
            onChange={(v) => {
              if (v === 'solid') {
                setWantImage(false)
                set('Use a solid background', (t) => void (t.background = { type: 'solid' }))
              }
              else if (lastImage) set('Use a background image', (t) => void (t.background = { type: 'image', imageUrl: lastImage, overlay: 40 }))
              else setWantImage(true)
            }}
          />
          {(theme.background.type === 'image' || wantImage) && (
            <BackgroundImage readOnly={readOnly} onImage={(url) => setLastImage(url)} />
          )}
        </PanelSection>

        <PanelSection title="Logo" description="Shown at the top of every screen. SVG, PNG, JPG or WebP up to 5 MB.">
          <ImageUpload
            label="Logo image"
            purpose="logo"
            aspect="aspect-[3/1]"
            value={theme.logo?.url}
            disabled={readOnly}
            onChange={(url) => set(url ? 'Change logo' : 'Remove logo', (t) => void (t.logo = url ? { url, position: t.logo?.position ?? 'left', alt: t.logo?.alt } : null))}
          />
          {theme.logo && (
            <>
              <SegmentRow
                label="Position"
                value={theme.logo.position}
                disabled={readOnly}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Centre' },
                ]}
                onChange={(v) => set('Move logo', (t) => void (t.logo && (t.logo.position = v)))}
              />
              <TextRow
                label="Logo description (alt text)"
                description="Usually your organisation’s name."
                value={theme.logo.alt ?? ''}
                maxLength={200}
                disabled={readOnly}
                onChange={(v) => set('Edit logo text', (t) => void (t.logo && (t.logo.alt = v || undefined)), 'theme:logo:alt')}
              />
            </>
          )}
        </PanelSection>

        <PanelSection title="Buttons">
          <SegmentRow
            label="Corners"
            value={theme.buttonRadius}
            disabled={readOnly}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'pill', label: 'Pill' },
            ]}
            onChange={(v) => set('Change button corners', (t) => void (t.buttonRadius = v))}
          />
        </PanelSection>

        <SavedThemes />
      </div>

      <section aria-label="Live preview" className="flex min-h-0 flex-col bg-muted">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
          <p className="text-caption text-muted-foreground">Live preview. Changes save automatically.</p>
          <DeviceToggle value={device} onChange={setDevice} />
        </div>
        <div className={cn('min-h-0 flex-1', device === 'mobile' ? 'p-6' : 'p-0')}>
          <FormPreview device={device} />
        </div>
      </section>
    </div>
  )

}

function PresetCard({ preset, active, disabled, onPick }: { preset: ThemePreset; active: boolean; disabled: boolean; onPick(): void }) {
  const t = preset.theme
  useEffect(() => {
    void loadThemeFont(t.questionFont ?? t.font)
  }, [t.font, t.questionFont])
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'focus-ring grid w-full gap-1.5 rounded-lg border border-border p-1.5 text-left transition-colors hover:border-input disabled:cursor-not-allowed',
        active && 'border-border-ink bg-primary ring-1 ring-border-ink',
      )}
    >
      {/* The swatch shows the preset's own colours: theme data, not app chrome. */}
      <span className="grid h-16 content-between rounded-md p-2.5" style={{ background: t.colors.background }}>
        <span className="text-label" style={{ color: t.colors.question, fontFamily: `"${t.questionFont ?? t.font} Variable", "${t.questionFont ?? t.font}"` }}>
          Aa
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-8" style={{ background: t.colors.button, borderRadius: t.buttonRadius === 'pill' ? 999 : t.buttonRadius === 'square' ? 0 : 4 }} />
          <span className="size-3 rounded-full" style={{ background: t.colors.answer }} />
        </span>
      </span>
      <span className="flex items-center justify-between px-1 text-caption text-foreground">
        {preset.name}
        <span className="text-muted-foreground">{preset.mode === 'dark' ? 'Dark' : 'Light'}</span>
      </span>
    </button>
  )
}

function ColorField({ label, help, value, onChange, disabled, warn }: { label: string; help: string; value: string; onChange(v: string): void; disabled: boolean; warn: boolean }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(value)
  }
  const valid = /^#[0-9a-f]{6}$/i.test(text)
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_7rem] items-center gap-3">
      <input
        type="color"
        aria-label={`${label} colour picker`}
        value={value.toLowerCase()}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="focus-ring size-10 cursor-pointer rounded-md border border-input bg-field p-1 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="grid">
        <span className="text-label text-foreground">
          {label}
          {warn && <span className="sr-only"> (low contrast)</span>}
        </span>
        <span className="text-caption text-muted-foreground">{help}</span>
      </label>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        maxLength={7}
        aria-invalid={!valid || undefined}
        className={cn('h-(--control-sm) font-mono text-body-sm uppercase', warn && 'border-warning-subtle-foreground')}
        onChange={(e) => {
          const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
          setText(v)
          if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase())
        }}
        onBlur={() => setText(value)}
      />
    </div>
  )
}

function FontSelect({ label, value, onChange, disabled, allowSame }: { label: string; value: ThemeFont | null; onChange(f: ThemeFont | null): void; disabled: boolean; allowSame?: boolean }) {
  useEffect(() => {
    void loadThemeFont(value)
  }, [value])
  const options = [...(allowSame ? [{ value: 'same', label: 'Same as the font' }] : []), ...THEME_FONTS.map((f) => ({ value: f, label: f }))]
  return (
    <SelectRow
      label={label}
      value={value ?? (allowSame ? 'same' : null)}
      options={options}
      disabled={disabled}
      onChange={(v) => onChange(v === 'same' ? null : (v as ThemeFont))}
    />
  )
}

function BackgroundImage({ readOnly, onImage }: { readOnly: boolean; onImage(url: string): void }) {
  const store = useBuilderStore()
  const bg = useBuilder((s) => s.doc.theme.background)
  const id = useId()
  const set = (label: string, recipe: (t: FormTheme) => void, key?: string) => store.getState().commit(label, (d) => void recipe(d.theme as FormTheme), key)
  return (
    <>
      <ImageUpload
        label="Background image"
        purpose="image"
        value={bg.type === 'image' ? bg.imageUrl : null}
        disabled={readOnly}
        onChange={(url) => {
          if (url) onImage(url)
          set(url ? 'Set background image' : 'Remove background image', (t) => void (t.background = url ? { type: 'image', imageUrl: url, overlay: bg.type === 'image' ? bg.overlay : 40 } : { type: 'solid' }))
        }}
      />
      {bg.type === 'image' && (
        <div className="grid gap-1.5">
          <div className="flex justify-between text-label">
            <span id={id}>Darken</span>
            <span className="text-muted-foreground tabular-nums">{bg.overlay}%</span>
          </div>
          <Slider
            aria-labelledby={id}
            min={0}
            max={80}
            step={5}
            value={[bg.overlay]}
            disabled={readOnly}
            onValueChange={([v]) => set('Change overlay', (t) => void (t.background.type === 'image' && (t.background.overlay = v ?? 0)), 'theme:overlay')}
            className="py-1"
          />
          <p className="text-caption text-muted-foreground">Darkens the image so text stays readable. Contrast is checked against the background colour under it.</p>
        </div>
      )}
    </>
  )
}

function SavedThemes() {
  const store = useBuilderStore()
  const readOnly = useBuilder((s) => s.readOnly)
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const themes = useQuery({ queryKey: ['themes'], queryFn: () => api<SavedThemesResponse>('/api/themes') })
  const save = useMutation({
    mutationFn: () => api<SavedTheme>('/api/themes', { method: 'POST', body: { name: name.trim(), settings: store.getState().doc.theme } }),
    onSuccess: () => {
      toast.success('Theme saved')
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['themes'] })
    },
    onError: (err) => setError(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/themes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Theme deleted')
      void queryClient.invalidateQueries({ queryKey: ['themes'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <PanelSection title="Saved themes" description="Save this design to reuse it on other forms.">
      {!readOnly && (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return setError('Enter a name for the theme')
            setError(null)
            save.mutate()
          }}
        >
          <TextRow label="Theme name" value={name} maxLength={80} placeholder="e.g. Acme brand" error={error} onChange={(v) => (setName(v), setError(null))} className="h-(--control-sm)" />
          <Button type="submit" size="sm" variant="secondary" className="mt-6.5" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <Save aria-hidden />}
            Save
          </Button>
        </form>
      )}
      {themes.isPending ? (
        <p className="text-caption text-muted-foreground">Loading saved themes…</p>
      ) : themes.data?.themes.length ? (
        <ul className="grid gap-1.5" aria-label="Saved themes">
          {themes.data.themes.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-md border border-border p-1.5 pl-2">
              <span className="flex shrink-0 gap-0.5" aria-hidden>
                {[t.settings.colors.background, t.settings.colors.question, t.settings.colors.button].map((c, i) => (
                  <span key={i} className="size-4 rounded-sm ring-1 ring-border" style={{ background: c }} />
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm">{t.name}</span>
              {!readOnly && (
                <>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      store.getState().commit(`Apply ${t.name}`, (d) => void (d.theme = structuredClone(t.settings)))
                      toast.success(`${t.name} applied`)
                    }}
                  >
                    Apply
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => remove.mutate(t.id)}>
                    <Trash2 aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">No saved themes yet.</p>
      )}
    </PanelSection>
  )
}

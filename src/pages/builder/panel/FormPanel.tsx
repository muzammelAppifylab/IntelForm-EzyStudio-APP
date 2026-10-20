import { useState } from 'react'
import { Link } from 'react-router'
import { LAYOUT_LABEL, LAYOUTS, type Layout } from '@shared/form/definition'
import { isSafeUrl } from '@shared/form/safe-url'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/components/ui/cn'
import { Note, NumberRow, PanelSection, SwitchRow, TextRow } from '@/builder/controls'
import { ImageUpload } from '@/builder/ImageUpload'
import { PipeInput } from '@/builder/pipe/PipeInput'
import { useBuilder, useBuilderStore } from '@/builder/store'

const LAYOUT_HELP: Record<Layout, string> = {
  all_at_once: 'Every question on one scrolling page, one Submit button.',
  section_by_section: 'One page per section break, with Back, Next and a progress bar.',
  one_at_a_time: 'One question per screen, large type. Enter moves on.',
}

/** With nothing selected: form-level options (layout), plus the start and end screens. */
export function FormPanel({ focus }: { focus: 'start' | 'end' | null }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-label text-foreground">{focus === 'start' ? 'Start screen' : focus === 'end' ? 'End screen' : 'Form'}</h2>
        <p className="text-caption text-muted-foreground">
          {focus ? 'Shown in every layout.' : 'Select a question on the canvas to edit it.'}
        </p>
      </div>
      {!focus && <LayoutSection />}
      {focus !== 'end' && <StartScreenSection />}
      {focus !== 'start' && <EndScreenSection />}
    </div>
  )
}

function LayoutSection() {
  const store = useBuilderStore()
  const layout = useBuilder((s) => s.doc.draft.layout)
  const readOnly = useBuilder((s) => s.readOnly)
  const hasSections = useBuilder((s) => s.doc.draft.fields.some((f) => f.type === 'section_break'))
  return (
    <PanelSection title="Layout" description="A display setting: switch any time, answers are kept.">
      <RadioGroup
        aria-label="Layout"
        value={layout}
        onValueChange={(v) => store.getState().commit('Change layout', (d) => void (d.draft.layout = v as Layout))}
        disabled={readOnly}
        className="grid gap-2"
      >
        {LAYOUTS.map((l) => (
          <Label
            key={l}
            htmlFor={`layout-${l}`}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 font-normal transition-colors hover:border-input',
              layout === l && 'border-option-selected-border bg-option-selected',
            )}
          >
            <RadioGroupItem id={`layout-${l}`} value={l} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-label text-foreground">{LAYOUT_LABEL[l]}</span>
              <span className="text-caption text-muted-foreground">{LAYOUT_HELP[l]}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {layout === 'section_by_section' && !hasSections && (
        <Note>Add a Section break (Layout group) to split the form into pages. Until then it is one page.</Note>
      )}
    </PanelSection>
  )
}

function StartScreenSection() {
  const store = useBuilderStore()
  const start = useBuilder((s) => s.doc.draft.startScreen)
  const readOnly = useBuilder((s) => s.readOnly)
  const set = (recipe: (s: typeof start) => void, key?: string, label = 'Edit start screen') =>
    store.getState().commit(label, (d) => void recipe(d.draft.startScreen), key)

  return (
    <PanelSection title="Start screen">
      <SwitchRow
        label="Show a start screen"
        description="A welcome before the first question."
        checked={start.enabled}
        disabled={readOnly}
        onCheckedChange={(v) =>
          set((s) => {
            s.enabled = v
            if (v && !s.title) s.title = store.getState().doc.title
          })
        }
      />
      {start.enabled && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-label">Title</Label>
            <PipeInput ariaLabel="Start screen title" value={start.title} beforeIndex={0} readOnly={readOnly} onChange={(v) => set((s) => void (s.title = v.slice(0, 200)), 'start:title')} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-label">Description</Label>
            <PipeInput
              ariaLabel="Start screen description"
              multiline
              value={start.description ?? ''}
              beforeIndex={0}
              readOnly={readOnly}
              onChange={(v) => set((s) => void (s.description = v.slice(0, 2000) || undefined), 'start:description')}
            />
          </div>
          <TextRow label="Button label" value={start.button} maxLength={40} disabled={readOnly} onChange={(v) => set((s) => void (s.button = v), 'start:button')} />
          <NumberRow
            label="Takes about (minutes)"
            description="Shown as “Takes about 3 minutes”. Leave empty to hide."
            value={start.minutes ?? null}
            min={1}
            max={120}
            placeholder="Hidden"
            disabled={readOnly}
            onChange={(v) => set((s) => void (s.minutes = v))}
          />
          <ImageUpload label="Image" value={start.imageUrl} purpose="image" disabled={readOnly} onChange={(url) => set((s) => void (s.imageUrl = url))} />
          {start.imageUrl && (
            <TextRow
              label="Image description (alt text)"
              description="Describe the image for people who can’t see it."
              value={start.imageAlt ?? ''}
              maxLength={300}
              disabled={readOnly}
              onChange={(v) => set((s) => void (s.imageAlt = v || undefined), 'start:alt')}
            />
          )}
        </>
      )}
    </PanelSection>
  )
}

function EndScreenSection() {
  const store = useBuilderStore()
  const end = useBuilder((s) => s.doc.draft.endScreen)
  const formId = useBuilder((s) => s.meta.id)
  const redirect = useBuilder((s) => (s.settings.afterSubmit === 'redirect' ? s.settings.redirectUrl : null))
  const readOnly = useBuilder((s) => s.readOnly)
  const set = (recipe: (s: typeof end) => void, key?: string, label = 'Edit end screen') => store.getState().commit(label, (d) => void recipe(d.draft.endScreen), key)
  const [showButton, setShowButton] = useState(!!end.button)
  const [btnLabel, setBtnLabel] = useState(end.button?.label ?? 'Visit our website')
  const [btnUrl, setBtnUrl] = useState(end.button?.url ?? '')

  const saveButton = (label: string, url: string) => {
    if (label.trim() && isSafeUrl(url.trim())) set((s) => void (s.button = { label: label.trim().slice(0, 40), url: url.trim() }), 'end:button')
    else if (end.button) set((s) => void (s.button = null), 'end:button')
  }

  return (
    <PanelSection title="End screen">
      {redirect && (
        <Note>
          Respondents are sent to {redirect} after they submit, so this screen isn’t shown.{' '}
          <Link className="underline" to={`/dashboard/forms/${formId}/settings#after-submit`}>
            Change in Settings
          </Link>
        </Note>
      )}
      <div className="grid gap-1.5">
        <Label className="text-label">Title</Label>
        <PipeInput ariaLabel="End screen title" value={end.title} readOnly={readOnly} onChange={(v) => set((s) => void (s.title = v.slice(0, 200)), 'end:title')} placeholder="Thanks!" />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-label">Message</Label>
        <PipeInput ariaLabel="End screen message" multiline value={end.message} readOnly={readOnly} onChange={(v) => set((s) => void (s.message = v.slice(0, 2000)), 'end:message')} />
        <p className="text-caption text-muted-foreground">Type @ to thank people by name, e.g. “Thanks, @First name”.</p>
      </div>
      <SwitchRow
        label="Button under the message"
        checked={showButton}
        disabled={readOnly}
        onCheckedChange={(v) => {
          setShowButton(v)
          if (v) saveButton(btnLabel, btnUrl)
          else set((s) => void (s.button = null))
        }}
      />
      {showButton && (
        <>
          <TextRow label="Button label" value={btnLabel} maxLength={40} disabled={readOnly} onChange={(v) => (setBtnLabel(v), saveButton(v, btnUrl))} />
          <TextRow
            label="Button link"
            type="url"
            value={btnUrl}
            placeholder="https://example.com"
            disabled={readOnly}
            error={btnUrl && !isSafeUrl(btnUrl.trim()) ? 'Enter a full link starting with https://' : null}
            onChange={(v) => (setBtnUrl(v), saveButton(btnLabel, v))}
          />
        </>
      )}
    </PanelSection>
  )
}

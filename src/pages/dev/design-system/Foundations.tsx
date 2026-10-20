import { Section, Specimen } from './parts'

const PALETTES = [
  { name: 'paper', anchor: '50' },
  { name: 'ink', anchor: '950' },
  { name: 'periwinkle', anchor: '200' },
  { name: 'pine', anchor: '700' },
  { name: 'persimmon', anchor: '500' },
  { name: 'raspberry', anchor: '600' },
  { name: 'ochre', anchor: '500' },
  { name: 'info', anchor: '500' },
]
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']

/** Semantic tokens, grouped. A pair is [fill, text on it]; a single name is shown on `card`. */
const SEMANTIC: { group: string; tokens: [string, string?][] }[] = [
  {
    group: 'Surfaces',
    tokens: [
      ['background', 'foreground'],
      ['card', 'card-foreground'],
      ['popover', 'popover-foreground'],
      ['muted', 'muted-foreground'],
      ['secondary', 'secondary-foreground'],
      ['chamber', 'chamber-foreground'],
      ['chamber', 'chamber-muted'],
      ['accent', 'accent-foreground'],
      ['sidebar', 'sidebar-foreground'],
      ['sidebar-accent', 'sidebar-accent-foreground'],
    ],
  },
  {
    group: 'Actions',
    tokens: [
      ['primary', 'primary-foreground'],
      ['primary-hover', 'primary-foreground'],
      ['pine', 'pine-foreground'],
      ['destructive', 'destructive-foreground'],
      ['highlight', 'highlight-foreground'],
      ['link'],
    ],
  },
  {
    group: 'Status',
    tokens: [
      ['success-subtle', 'success-subtle-foreground'],
      ['warning-subtle', 'warning-subtle-foreground'],
      ['info-subtle', 'info-subtle-foreground'],
      ['danger-subtle', 'danger-subtle-foreground'],
    ],
  },
  {
    group: 'Lines and focus',
    tokens: [['border'], ['border-ink'], ['primary-border'], ['input'], ['ring']],
  },
  {
    group: 'Form',
    tokens: [
      ['field', 'foreground'],
      ['field-placeholder'],
      ['option', 'foreground'],
      ['option-border'],
      ['option-selected', 'option-selected-foreground'],
      ['option-selected-border'],
      ['progress'],
      ['progress-track'],
      ['rating'],
      ['rating-empty'],
    ],
  },
  {
    group: 'Data',
    tokens: [
      ['nps-detractor'],
      ['nps-passive'],
      ['nps-promoter'],
      ['chart-1'],
      ['chart-2'],
      ['chart-3'],
      ['chart-4'],
      ['chart-5'],
      ['chart-6'],
    ],
  },
]

const TYPE_SCALE = [
  { cls: 'text-hero', spec: 'Instrument Serif 96/92 · 400', sample: 'Forms people finish', use: 'Front page hero only' },
  { cls: 'text-title', spec: 'Instrument Serif 56/56 · 400', sample: 'Customer feedback', use: 'Public page titles' },
  { cls: 'text-heading', spec: 'Instrument Serif 40/44 · 400', sample: 'Your forms', use: 'Dashboard and builder page titles' },
  { cls: 'text-heading-sm', spec: 'Instrument Serif 28/32 · 400', sample: 'Most new responses', use: 'Section titles in chambers and large cards' },
  { cls: 'text-subheading', spec: 'Figtree 18/24 · 600', sample: 'Recent responses', use: 'Card and panel titles' },
  { cls: 'text-question-xl', spec: 'Instrument Serif 40/44 · 400', sample: 'What should we build next?', use: 'One-at-a-time question' },
  { cls: 'text-question', spec: 'Figtree 18/26 · 600', sample: 'How did you hear about us?', use: 'Classic and paged questions' },
  { cls: 'text-answer', spec: 'Figtree 16/24 · 400', sample: 'A friend or colleague', use: 'Respondent inputs, never below 16px' },
  { cls: 'text-body', spec: 'Figtree 16/24 · 400', sample: 'Share your form to start collecting responses.', use: 'Body copy' },
  { cls: 'text-body-sm', spec: 'Figtree 14/20 · 400', sample: 'Submitted 2 minutes ago from Dhaka', use: 'Tables and dense lists' },
  { cls: 'text-label', spec: 'Figtree 14/20 · 500', sample: 'Export CSV', use: 'Labels, buttons, tabs, nav' },
  { cls: 'text-caption', spec: 'Figtree 12/16 · 400', sample: "We'll only use this to reply.", use: 'Help text, timestamps' },
  { cls: 'text-overline', spec: 'Figtree 12/16 · 600 · 0.06em', sample: 'Responses', use: 'Eyebrows' },
  { cls: 'text-metric', spec: 'Instrument Serif 48/48 · 400 · tabular', sample: '1,284', use: 'Hero KPI numbers' },
]

export function Foundations() {
  return (
    <>
      <Section id="colour" title="Colour" intro="Seven 11-step OKLCH ramps are the reference values. Components use only the semantic tokens below.">
        <Specimen title="Palettes" note="Anchor step outlined. Reference only; never use a ramp step in a component." bodyClassName="grid gap-3">
          {PALETTES.map((p) => (
            <div key={p.name} className="grid min-w-0 grid-cols-[5rem_1fr] items-center gap-3">
              <span className="text-label text-foreground capitalize">{p.name}</span>
              <div className="grid min-w-0 grid-cols-11 gap-1">
                {STEPS.map((s) => (
                  <div key={s} className="grid min-w-0 gap-1">
                    <div
                      className={`h-9 rounded-sm ${s === p.anchor ? 'outline-2 outline-offset-1 outline-foreground outline-solid' : 'ring-1 ring-border ring-inset'}`}
                      style={{ background: `var(--palette-${p.name}-${s})` }}
                      title={`${p.name}-${s}`}
                    />
                    <span className="truncate text-center text-caption text-muted-foreground tabular-nums max-sm:hidden">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Specimen>
        <div className="grid gap-6 lg:grid-cols-2">
          {SEMANTIC.map((g) => (
            <Specimen key={g.group} title={g.group} bodyClassName="grid gap-2 sm:grid-cols-2">
              {g.tokens.map(([fill, text]) => (
                <div key={fill} className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-md text-label ring-1 ring-border ring-inset"
                    style={{ background: `var(--${fill})`, color: text ? `var(--${text})` : undefined }}
                    aria-hidden
                  >
                    {text ? 'Aa' : ''}
                  </span>
                  <span className="grid min-w-0">
                    <code className="truncate font-mono text-caption text-foreground">{fill}</code>
                    {text && <code className="truncate font-mono text-caption text-muted-foreground">on: {text}</code>}
                  </span>
                </div>
              ))}
            </Specimen>
          ))}
        </div>
      </Section>

      <Section id="type" title="Type" intro="Figtree for every UI string, Instrument Serif at weight 400 for titles and big numbers (never bold), JetBrains Mono for slugs and payloads.">
        <div className="grid divide-y divide-border rounded-lg border border-border bg-card">
          {TYPE_SCALE.map((t) => (
            <div key={t.cls} className="grid gap-2 p-4 sm:grid-cols-[12rem_1fr] sm:gap-6 sm:p-6">
              <div className="grid content-start gap-0.5">
                <code className="font-mono text-caption text-foreground">{t.cls}</code>
                <span className="text-caption text-muted-foreground">{t.spec}</span>
                <span className="text-caption text-muted-foreground">{t.use}</span>
              </div>
              <p className={`${t.cls} min-w-0 break-words text-foreground`}>{t.sample}</p>
            </div>
          ))}
          <div className="grid gap-2 p-4 sm:grid-cols-[12rem_1fr] sm:gap-6 sm:p-6">
            <div className="grid content-start gap-0.5">
              <code className="font-mono text-caption text-foreground">font-mono</code>
              <span className="text-caption text-muted-foreground">JetBrains Mono</span>
            </div>
            <code className="font-mono text-body-sm break-all text-foreground">/f/customer-feedback-2026</code>
          </div>
        </div>
      </Section>

      <Section id="shape" title="Shape and elevation" intro="Six radii and one shadow. Cards and panels rest on a border; only menus, popovers, dialogs and the dragged field get shadow-pop.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="Radius" bodyClassName="grid grid-cols-3 gap-4 sm:grid-cols-6">
            {[
              ['rounded-sm', '8px · checkboxes, chips'],
              ['rounded-md', '12px · inputs, buttons'],
              ['rounded-lg', '20px · cards, panels'],
              ['rounded-xl', '32px · dialogs'],
              ['rounded-2xl', '48px · front page chambers'],
              ['rounded-full', 'pills, badges, switches'],
            ].map(([cls, use]) => (
              <div key={cls} className="grid content-start gap-2">
                <div className={`h-14 border border-input bg-accent ${cls}`} />
                <code className="font-mono text-caption text-foreground">{cls.replace('rounded-', '')}</code>
                <span className="text-caption text-muted-foreground">{use}</span>
              </div>
            ))}
          </Specimen>
          <Specimen title="Edges and elevation" bodyClassName="grid grid-cols-3 gap-4">
            {[
              ['border', '1px hairline · cards, tables'],
              ['border-2 border-border-ink', '2px ink · buttons, selected'],
              ['shadow-pop', 'menus, popovers, dialogs, dragged field'],
            ].map(([cls, use]) => (
              <div key={cls} className="grid content-start gap-2">
                <div className={`h-14 rounded-lg bg-card ${cls}`} />
                <code className="font-mono text-caption text-foreground">{cls.replace('border-2 ', '')}</code>
                <span className="text-caption text-muted-foreground">{use}</span>
              </div>
            ))}
          </Specimen>
        </div>
      </Section>
    </>
  )
}

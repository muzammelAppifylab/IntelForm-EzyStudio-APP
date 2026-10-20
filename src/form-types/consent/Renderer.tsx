import { Check, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { FORM_FONT, FORM_RADIUS, KEY_SELECTED, TILE_BASE, tileState } from '@/components/ds/tokens'
import type { FieldRendererProps } from '@/respondent/types'
import { Group } from '@/respondent/ui'

/** One checkbox with the consent text and an optional link. The browser sends { accepted, at }. */
export default function ConsentRenderer(p: FieldRendererProps<'consent'>) {
  const { field, value, onChange } = p
  const checked = !!value && typeof value === 'object' && (value as { accepted?: unknown }).accepted === true
  const { text, link } = field.props
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'text-question-xl' : undefined}>
      <label
        data-state={checked ? 'checked' : 'unchecked'}
        className={clsx(TILE_BASE, tileState(checked), FORM_RADIUS, FORM_FONT, 'min-h-(--control-lg) items-start gap-3 px-4 py-3 text-answer')}
      >
        <input
          id={p.inputId}
          type="checkbox"
          checked={checked}
          aria-invalid={p.invalid || undefined}
          aria-required={field.required || undefined}
          onChange={(e) => onChange(e.target.checked ? { accepted: true, at: new Date().toISOString() } : undefined)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={clsx(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border',
            checked ? KEY_SELECTED : 'border-input bg-field',
          )}
        >
          {checked && <Check strokeWidth={3} className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 break-words">{text}</span>
      </label>
      {link && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-body text-[color:var(--form-answer,var(--primary))] underline underline-offset-4"
        >
          {link.label}
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </Group>
  )
}

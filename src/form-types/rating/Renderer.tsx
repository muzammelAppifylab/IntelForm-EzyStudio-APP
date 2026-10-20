import { RatingScale } from '@/components/ds/RatingScale'
import type { FieldRendererProps } from '@/respondent/types'

export default function RatingRenderer(p: FieldRendererProps<'rating'>) {
  const { field, value, onChange } = p
  return (
    <RatingScale
      name={p.inputId}
      legend={
        <>
          {p.legend}
          {p.description && <span className="mt-2 block text-body font-normal text-muted-foreground">{p.description}</span>}
        </>
      }
      variant={field.props.style}
      max={field.props.scale}
      lowLabel={field.props.leftLabel || undefined}
      highLabel={field.props.rightLabel || undefined}
      required={field.required}
      error={p.error}
      value={typeof value === 'number' ? value : null}
      onChange={(n) => onChange(n)}
    />
  )
}

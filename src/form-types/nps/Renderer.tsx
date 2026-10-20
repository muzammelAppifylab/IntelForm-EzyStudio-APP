import { NpsScale } from '@/components/ds/NpsScale'
import type { FieldRendererProps } from '@/respondent/types'

export default function NpsRenderer(p: FieldRendererProps<'nps'>) {
  const { field, value, onChange, labels } = p
  return (
    <NpsScale
      name={p.inputId}
      legend={
        <>
          {p.legend}
          {p.description && <span className="mt-2 block text-body font-normal text-muted-foreground">{p.description}</span>}
        </>
      }
      lowLabel={field.props.lowLabel || labels.npsLow}
      highLabel={field.props.highLabel || labels.npsHigh}
      required={field.required}
      error={p.error}
      value={typeof value === 'number' ? value : null}
      onChange={(n) => onChange(n)}
    />
  )
}

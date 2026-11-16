import type {FieldRendererProps} from '../../respondent/types';
import {RatingScale} from '../_respondent/scales';

export default function RatingRenderer(p: FieldRendererProps<'rating'>) {
  const {field, value, onChange} = p;
  return (
    <RatingScale
      name={p.inputId}
      legendClassName={p.large ? 'rf-question-xl' : undefined}
      legend={
        <>
          {p.legend}
          {p.description && <span className="ft-legend-description">{p.description}</span>}
        </>
      }
      variant={field.props.style}
      max={field.props.scale}
      lowLabel={field.props.leftLabel || undefined}
      highLabel={field.props.rightLabel || undefined}
      required={field.required}
      error={p.error}
      value={typeof value === 'number' ? value : null}
      onChange={n => onChange(n)}
    />
  );
}

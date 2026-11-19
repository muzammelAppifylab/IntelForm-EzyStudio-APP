import {RichText} from '../../respondent/rich/RichText';
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
          {p.description && <RichText as="span" html={p.description} className="ft-legend-description" />}
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

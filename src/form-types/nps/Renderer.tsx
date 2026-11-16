import type {FieldRendererProps} from '../../respondent/types';
import {NpsScale} from '../_respondent/scales';

export default function NpsRenderer(p: FieldRendererProps<'nps'>) {
  const {field, value, onChange, labels} = p;
  return (
    <NpsScale
      name={p.inputId}
      legendClassName={p.large ? 'rf-question-xl' : undefined}
      legend={
        <>
          {p.legend}
          {p.description && <span className="ft-legend-description">{p.description}</span>}
        </>
      }
      lowLabel={field.props.lowLabel || labels.npsLow}
      highLabel={field.props.highLabel || labels.npsHigh}
      required={field.required}
      error={p.error}
      value={typeof value === 'number' ? value : null}
      onChange={n => onChange(n)}
    />
  );
}

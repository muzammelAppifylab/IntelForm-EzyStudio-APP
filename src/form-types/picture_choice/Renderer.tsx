import {type KeyboardEvent, useMemo, useRef, useState} from 'react';

import type {FieldRendererProps} from '../../respondent/types';
import {Group} from '../../respondent/ui';
import {shuffled} from '../../respondent/util';
import {LETTERS} from '../_respondent/constants';
import {FtIcon} from '../_respondent/icons';

/** The next picture-choice selection after (un)ticking one option. */
export function nextPictureSelection(selected: ReadonlySet<string>, id: string, checked: boolean, multiple: boolean): string[] {
  if (!multiple) return checked ? [id] : [];
  const rest = [...selected].filter(x => x !== id);
  return checked ? [...rest, id] : rest;
}

/**
 * Image tiles with native radios (single) or checkboxes (multiple). Alt text falls back to the
 * label; letter keys pick while focus is on one of the tiles.
 */
export default function PictureChoiceRenderer(p: FieldRendererProps<'picture_choice'>) {
  const {field, value, onChange} = p;
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const options = useMemo(
    () => (field.props.randomize ? shuffled(field.props.options, seed) : field.props.options),
    [field.props.options, field.props.randomize, seed]
  );
  const multiple = field.props.multiple;
  const selected = new Set((Array.isArray(value) ? value : []).map((a: {option: string}) => a.option));
  const gridRef = useRef<HTMLDivElement>(null);

  const toggle = (id: string, checked: boolean) => {
    const next = nextPictureSelection(selected, id, checked, multiple);
    onChange(next.length ? next.map(option => ({option})) : undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLInputElement) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^[a-z]$/i.test(e.key)) {
      const i = LETTERS.indexOf(e.key.toUpperCase());
      const o = options[i];
      if (!o) return;
      e.preventDefault();
      toggle(o.id, multiple ? !selected.has(o.id) : true);
      gridRef.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus();
    } else if (multiple && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const inputs = Array.from(gridRef.current?.querySelectorAll<HTMLInputElement>('input') ?? []);
      const at = inputs.indexOf(t as HTMLInputElement);
      if (at < 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      inputs[(at + step + inputs.length) % inputs.length]?.focus();
    }
  };

  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={field.required} legendClassName={p.large ? 'rf-question-xl' : undefined}>
      <div ref={gridRef} onKeyDown={onKeyDown} className="ft-picture-grid" data-columns={field.props.columns}>
        {options.map((o, i) => {
          const checked = selected.has(o.id);
          const letter = LETTERS[i];
          return (
            <label key={o.id} data-state={checked ? 'checked' : 'unchecked'} className="ft-tile ft-tile-picture">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={p.inputId}
                value={o.id}
                checked={checked}
                aria-keyshortcuts={letter}
                aria-invalid={multiple && p.invalid ? true : undefined}
                required={!multiple && field.required}
                onChange={e => toggle(o.id, e.target.checked)}
                className="ft-sr-only"
              />
              <span className="ft-picture-frame">
                {o.imageUrl ? (
                  <img src={o.imageUrl} alt={o.alt || o.label} loading="lazy" decoding="async" className="ft-picture-img" />
                ) : (
                  <FtIcon name="image" className="ft-picture-placeholder" />
                )}
              </span>
              <span className="ft-picture-caption">
                {letter && (
                  <span aria-hidden className="ft-key">
                    {letter}
                  </span>
                )}
                <span className="ft-tile-label">{o.label}</span>
                <FtIcon name="check" className="ft-tile-check" />
              </span>
            </label>
          );
        })}
      </div>
    </Group>
  );
}

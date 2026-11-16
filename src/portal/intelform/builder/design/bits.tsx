import {type ReactNode, useEffect, useId, useRef, useState} from 'react';

import {THEME_FONTS, type ThemeFont, type ThemePreset} from '../../../../lib/intelform/form/theme-core';
import {Icon} from '../../../ui';
import {loadThemeFont} from '../fonts';
import {SelectRow} from '../settings/shared';
import {hexInput, isHex6, swatchVars, useCssVars} from './theme-edit';

/** One group of the design panel: a small heading, an optional line, its controls. */
export function DesignSection({title, description, children}: {title: string; description?: ReactNode; children: ReactNode}) {
  const id = useId();
  return (
    <section className="if-design-section" aria-labelledby={id}>
      <div className="if-design-section-head">
        <h3 id={id}>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A preset as a little card in its own colours and question font. */
export function PresetCard({preset, active, disabled, onPick}: {preset: ThemePreset; active: boolean; disabled: boolean; onPick: () => void}) {
  const t = preset.theme;
  const ref = useRef<HTMLSpanElement>(null);
  useCssVars(ref, swatchVars(t));
  useEffect(() => {
    void loadThemeFont(t.questionFont ?? t.font);
  }, [t.font, t.questionFont]);
  const mode = preset.mode === 'dark' ? 'Dark' : 'Light';
  return (
    <button
      type="button"
      className="if-preset"
      aria-pressed={active}
      aria-label={`${preset.name}, ${mode.toLowerCase()} preset`}
      disabled={disabled}
      onClick={onPick}>
      <span ref={ref} className="if-preset-swatch" aria-hidden="true">
        <span className="if-preset-aa">Aa</span>
        <span className="if-preset-bits">
          <span className="if-preset-button" />
          <span className="if-preset-answer" />
        </span>
      </span>
      <span className="if-preset-name">
        {preset.name}
        <span className="if-preset-mode">{mode}</span>
      </span>
    </button>
  );
}

/** A colour: the native picker, its name and help, and a hex box that saves once it is valid. */
export function ColorField({
  label,
  help,
  value,
  onChange,
  disabled,
  warn,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  warn: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  const valid = isHex6(text);
  return (
    <div className="if-color-field" data-warn={warn ? '' : undefined}>
      <input
        type="color"
        className="if-color-picker"
        aria-label={`${label} colour picker`}
        value={value.toLowerCase()}
        disabled={disabled}
        onChange={e => onChange(e.target.value.toUpperCase())}
      />
      <label htmlFor={id} className="if-color-text">
        <span className="if-row-label">
          {label}
          {warn && (
            <>
              <Icon name="warning" size={14} className="if-warn-icon" />
              <span className="visually-hidden"> (low contrast)</span>
            </>
          )}
        </span>
        <span className="if-row-hint">{help}</span>
      </label>
      <span className="field if-color-hex">
        <input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          disabled={disabled}
          aria-invalid={!valid || undefined}
          onChange={e => {
            const v = hexInput(e.target.value);
            setText(v);
            if (isHex6(v)) onChange(v.toUpperCase());
          }}
          onBlur={() => setText(value)}
        />
      </span>
    </div>
  );
}

const FONT_OPTIONS = THEME_FONTS.map(f => ({value: f as string, label: f as string}));
const SAME = 'same';

/** A theme font; `allowSame` adds "Same as the font" (null). Loads the face for the preview. */
export function FontSelect({
  label,
  value,
  onChange,
  disabled,
  allowSame,
}: {
  label: string;
  value: ThemeFont | null;
  onChange: (f: ThemeFont | null) => void;
  disabled: boolean;
  allowSame?: boolean;
}) {
  useEffect(() => {
    void loadThemeFont(value);
  }, [value]);
  const options = allowSame ? [{value: SAME, label: 'Same as the font'}, ...FONT_OPTIONS] : FONT_OPTIONS;
  return (
    <SelectRow
      label={label}
      value={value ?? (allowSame ? SAME : null)}
      options={options}
      disabled={disabled}
      onChange={v => onChange(v === SAME ? null : (v as ThemeFont))}
    />
  );
}

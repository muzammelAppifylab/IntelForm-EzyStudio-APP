import {NumberRow} from '../../portal/intelform/builder/controls';

/** Min / max characters for the text types; empty means no limit, `cap` is the hard maximum. */
export function LengthLimits({
  min,
  max,
  cap,
  onChange,
  readOnly,
}: {
  min: number | null;
  max: number | null;
  cap: number;
  onChange(p: {minLength?: number | null; maxLength?: number | null}): void;
  readOnly: boolean;
}) {
  return (
    <div className="fts-pair">
      <NumberRow label="Min characters" value={min} min={0} max={max ?? cap} onChange={v => onChange({minLength: v})} disabled={readOnly} placeholder="None" />
      <NumberRow
        label="Max characters"
        value={max}
        min={Math.max(1, min ?? 0)}
        max={cap}
        onChange={v => onChange({maxLength: v})}
        disabled={readOnly}
        placeholder={String(cap)}
      />
    </div>
  );
}

/** A short explanation under a type's settings. */
export function SettingsNote({children}: {children: string}) {
  return <p className="fts-note">{children}</p>;
}

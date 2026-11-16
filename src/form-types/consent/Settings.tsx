import {useState} from 'react';

import {isSafeUrl} from '../../lib/intelform/form/safe-url';
import {SwitchRow, TextRow} from '../../portal/intelform/builder/controls';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

export default function ConsentSettings({field, onChange, readOnly}: FieldSettingsProps<'consent'>) {
  const p = field.props;
  // The link is stored only once its address is a full https link (the definition rejects others).
  const [open, setOpen] = useState(p.link !== null);
  const [label, setLabel] = useState(p.link?.label ?? 'Privacy policy');
  const [url, setUrl] = useState(p.link?.url ?? '');
  const valid = isSafeUrl(url.trim());

  function save(nextLabel: string, nextUrl: string) {
    if (isSafeUrl(nextUrl.trim())) onChange({link: {label: nextLabel.trim() || 'Privacy policy', url: nextUrl.trim()}}, `link:${field.id}`);
    else if (p.link) onChange({link: null}, `link:${field.id}`);
  }

  return (
    <div className="fts-stack">
      <TextRow
        label="Checkbox text"
        multiline
        value={p.text}
        maxLength={1000}
        onChange={v => onChange({text: v}, `text:${field.id}`)}
        disabled={readOnly}
      />
      <SwitchRow
        label="Link to a document"
        description="For example your privacy policy."
        checked={open}
        onCheckedChange={v => {
          setOpen(v);
          if (!v) onChange({link: null});
          else save(label, url);
        }}
        disabled={readOnly}
      />
      {open && (
        <div className="fts-stack fts-stack-tight">
          <TextRow
            label="Link text"
            value={label}
            maxLength={100}
            onChange={v => {
              setLabel(v);
              save(v, url);
            }}
            disabled={readOnly}
          />
          <TextRow
            label="Link address"
            type="url"
            value={url}
            maxLength={2048}
            placeholder="https://example.com/privacy"
            error={url && !valid ? 'Enter a full link starting with https://' : null}
            onChange={v => {
              setUrl(v);
              save(label, v);
            }}
            disabled={readOnly}
          />
        </div>
      )}
      <SettingsNote>Each response records that the box was ticked, when, the text shown and the form version.</SettingsNote>
    </div>
  );
}

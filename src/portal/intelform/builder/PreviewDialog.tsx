import {useEffect, useState} from 'react';

import {LAYOUT_LABEL} from '../../../lib/intelform/form/definition';
import {FormRenderer} from '../../../respondent/FormRenderer';
import {Button, Modal, ToggleGroup} from '../../ui';
import {cn} from '../lib/utils';
import {loadThemeFont} from './fonts';
import {useBuilder} from './store';

export type Device = 'desktop' | 'mobile';

/** The live renderer on the current draft and theme, in a 390px or full-width frame. */
export function FormPreview({device, resetKey = 0, className}: {device: Device; resetKey?: number; className?: string}) {
  const draft = useBuilder(s => s.doc.draft);
  const theme = useBuilder(s => s.doc.theme);
  const stepSound = useBuilder(s => s.settings.stepSound);
  useEffect(() => {
    void loadThemeFont(theme.font);
    void loadThemeFont(theme.questionFont);
  }, [theme.font, theme.questionFont]);
  return (
    <div className={cn('if-form-preview', device === 'mobile' && 'is-mobile', className)} data-device={device}>
      <FormRenderer key={resetKey} definition={draft} theme={theme} mode="preview" device={device} stepSound={stepSound} />
    </div>
  );
}

export function DeviceToggle({value, onChange}: {value: Device; onChange(d: Device): void}) {
  return (
    <ToggleGroup
      label="Preview size"
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        {value: 'desktop', label: 'Desktop', icon: 'monitor'},
        {value: 'mobile', label: 'Mobile', icon: 'smartphone'},
      ]}
    />
  );
}

/** Preview: the form as respondents see it, answers not saved. Restart starts it over. */
export function PreviewDialog({open, onOpenChange}: {open: boolean; onOpenChange(o: boolean): void}) {
  const [device, setDevice] = useState<Device>('desktop');
  const [resetKey, setResetKey] = useState(0);
  const layout = useBuilder(s => s.doc.draft.layout);
  return (
    <Modal open={open} onClose={() => onOpenChange(false)} size="lg" title="Preview" description={`${LAYOUT_LABEL[layout]} layout. Answers here are not saved.`}>
      {/* Keys pressed in the preview are the respondent's, never the Build tab's shortcuts (Delete, arrows, /). */}
      <div className="if-preview" onKeyDown={e => e.stopPropagation()}>
        <div className="if-preview-tools">
          <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => setResetKey(k => k + 1)}>
            Restart
          </Button>
          <DeviceToggle value={device} onChange={setDevice} />
        </div>
        <div className={cn('if-preview-stage', device === 'mobile' && 'is-mobile')}>
          <FormPreview device={device} resetKey={resetKey} />
        </div>
      </div>
    </Modal>
  );
}

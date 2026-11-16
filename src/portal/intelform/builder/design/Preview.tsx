import {FormRenderer} from '../../../../respondent/FormRenderer';
import {ToggleGroup} from '../../../ui';
import {useBuilder} from '../store';

export type Device = 'desktop' | 'mobile';

/**
 * The live renderer on the current draft and theme: full width, or a 390 px phone frame. Answers
 * typed here go nowhere (mode "preview"). `resetKey` restarts it.
 */
export function FormPreview({device, resetKey = 0}: {device: Device; resetKey?: number}) {
  const draft = useBuilder(s => s.doc.draft);
  const theme = useBuilder(s => s.doc.theme);
  const stepSound = useBuilder(s => s.settings.stepSound);
  return (
    <div className={`if-preview-frame if-preview-${device}`} data-device={device}>
      <FormRenderer key={resetKey} definition={draft} theme={theme} mode="preview" device={device} stepSound={stepSound} />
    </div>
  );
}

export function DeviceToggle({value, onChange}: {value: Device; onChange: (d: Device) => void}) {
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

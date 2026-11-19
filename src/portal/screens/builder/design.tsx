import {useState} from 'react';

import {DesignPanel} from '../../intelform/builder/design/DesignPanel';
import {DeviceToggle, FormPreview, type Device} from '../../intelform/builder/design/Preview';
import {Button} from '../../ui';

/**
 * `/forms/$formId/design`: the form's theme (presets, colours, fonts, background, logo, button
 * corners, saved themes) on the left, a live preview on the right. Theme edits are undoable and
 * autosave with the draft. Rendered inside BuilderLayout, which provides the builder store.
 */
export function DesignTab() {
  const [device, setDevice] = useState<Device>('desktop');
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className="app-page screen-design">
      <h2 className="visually-hidden">Design</h2>
      <div className="if-design-layout">
        <DesignPanel />
        <section aria-label="Live preview" className="if-design-preview">
          <div className="if-design-preview-bar">
            <p>Live preview. Answers here are not saved.</p>
            <div className="if-row-actions">
              <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={() => setResetKey(k => k + 1)}>
                Restart
              </Button>
              <DeviceToggle value={device} onChange={setDevice} />
            </div>
          </div>
          <div className="if-design-preview-body" data-device={device}>
            <FormPreview device={device} resetKey={resetKey} />
          </div>
        </section>
      </div>
    </div>
  );
}

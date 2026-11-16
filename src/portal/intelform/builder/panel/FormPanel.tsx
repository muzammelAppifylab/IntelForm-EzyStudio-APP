import {Link} from '@tanstack/react-router';
import {useId, useState} from 'react';

import {LAYOUT_LABEL, LAYOUTS, type Layout} from '../../../../lib/intelform/form/definition';
import {RadioGroup} from '../../../ui';
import {PipeInput} from '../pipe/PipeInput';
import {useBuilder, useBuilderStore} from '../store';
import {clip, endButtonFrom, endButtonUrlError, LAYOUT_HELP} from './model';
import {PanelImage} from './PanelImage';
import {Note, NumberRow, PanelSection, PipeLabel, SwitchRow, TextRow} from '../controls';
import './panel.css';

/** With nothing selected: form-level options (layout), plus the start and end screens. */
export function FormPanel({focus}: {focus: 'start' | 'end' | null}) {
  return (
    <div className="if-form-panel">
      <div className="if-panel-head">
        <div className="if-panel-head-text">
          <p className="if-panel-overline">{focus ? 'Screen' : 'Form'}</p>
          <h2>{focus === 'start' ? 'Start screen' : focus === 'end' ? 'End screen' : 'Form settings'}</h2>
          <p className="if-panel-text">{focus ? 'Shown in every layout.' : 'Select a question on the canvas to edit it.'}</p>
        </div>
      </div>
      {!focus && <LayoutSection />}
      {focus !== 'end' && <StartScreenSection />}
      {focus !== 'start' && <EndScreenSection />}
    </div>
  );
}

function LayoutSection() {
  const store = useBuilderStore();
  const layout = useBuilder(s => s.doc.draft.layout);
  const readOnly = useBuilder(s => s.readOnly);
  const hasSections = useBuilder(s => s.doc.draft.fields.some(f => f.type === 'section_break'));
  return (
    <PanelSection title="Layout" description="A display setting: switch any time, answers are kept.">
      <RadioGroup<Layout>
        legend="Layout"
        hideLegend
        value={layout}
        disabled={readOnly}
        onChange={v => store.getState().commit('Change layout', d => void (d.draft.layout = v))}
        options={LAYOUTS.map(l => ({value: l, label: LAYOUT_LABEL[l], description: LAYOUT_HELP[l]}))}
      />
      {layout === 'section_by_section' && !hasSections && (
        <Note>Add a Section break (Layout group) to split the form into pages. Until then it is one page.</Note>
      )}
    </PanelSection>
  );
}

function StartScreenSection() {
  const store = useBuilderStore();
  const start = useBuilder(s => s.doc.draft.startScreen);
  const readOnly = useBuilder(s => s.readOnly);
  const titleId = useId();
  const descriptionId = useId();
  const set = (recipe: (s: typeof start) => void, key?: string, label = 'Edit start screen') =>
    store.getState().commit(label, d => void recipe(d.draft.startScreen), key);

  return (
    <PanelSection title="Start screen">
      <SwitchRow
        label="Show a start screen"
        description="A welcome before the first question."
        checked={start.enabled}
        disabled={readOnly}
        onCheckedChange={v =>
          set(s => {
            s.enabled = v;
            if (v && !s.title) s.title = store.getState().doc.title;
          })
        }
      />
      {start.enabled && (
        <>
          <div className="if-panel-pipe">
            <PipeLabel htmlFor={titleId}>Title</PipeLabel>
            <PipeInput
              id={titleId}
              ariaLabel="Start screen title"
              value={start.title}
              beforeIndex={0}
              readOnly={readOnly}
              onChange={v => set(s => void (s.title = clip(v, 200)), 'start:title')}
            />
          </div>
          <div className="if-panel-pipe">
            <PipeLabel htmlFor={descriptionId}>Description</PipeLabel>
            <PipeInput
              id={descriptionId}
              ariaLabel="Start screen description"
              multiline
              value={start.description ?? ''}
              beforeIndex={0}
              readOnly={readOnly}
              onChange={v => set(s => void (s.description = clip(v, 2000) || undefined), 'start:description')}
            />
          </div>
          <TextRow
            label="Button label"
            value={start.button}
            maxLength={40}
            disabled={readOnly}
            onChange={v => set(s => void (s.button = v), 'start:button')}
          />
          <NumberRow
            label="Takes about (minutes)"
            description="Shown as “Takes about 3 minutes”. Leave empty to hide."
            value={start.minutes ?? null}
            min={1}
            max={120}
            placeholder="Hidden"
            disabled={readOnly}
            onChange={v => set(s => void (s.minutes = v))}
          />
          <PanelImage label="Image" value={start.imageUrl} purpose="image" disabled={readOnly} onChange={url => set(s => void (s.imageUrl = url))} />
          {start.imageUrl && (
            <TextRow
              label="Image description (alt text)"
              description="Describe the image for people who can’t see it."
              value={start.imageAlt ?? ''}
              maxLength={300}
              disabled={readOnly}
              onChange={v => set(s => void (s.imageAlt = v || undefined), 'start:alt')}
            />
          )}
        </>
      )}
    </PanelSection>
  );
}

function EndScreenSection() {
  const store = useBuilderStore();
  const end = useBuilder(s => s.doc.draft.endScreen);
  const formId = useBuilder(s => s.meta.id);
  const redirect = useBuilder(s => (s.settings.afterSubmit === 'redirect' ? s.settings.redirectUrl : null));
  const readOnly = useBuilder(s => s.readOnly);
  const titleId = useId();
  const messageId = useId();
  const set = (recipe: (s: typeof end) => void, key?: string, label = 'Edit end screen') =>
    store.getState().commit(label, d => void recipe(d.draft.endScreen), key);
  const [showButton, setShowButton] = useState(!!end.button);
  const [btnLabel, setBtnLabel] = useState(end.button?.label ?? 'Visit our website');
  const [btnUrl, setBtnUrl] = useState(end.button?.url ?? '');

  const saveButton = (label: string, url: string) => {
    const next = endButtonFrom(label, url, !!end.button);
    if (next !== undefined) set(s => void (s.button = next), 'end:button');
  };

  return (
    <PanelSection title="End screen">
      {redirect && (
        <Note>
          Respondents are sent to {redirect} after they submit, so this screen isn’t shown.{' '}
          <Link to="/forms/$formId/settings" params={{formId}} hash="after-submit">
            Change in Settings
          </Link>
        </Note>
      )}
      <div className="if-panel-pipe">
        <PipeLabel htmlFor={titleId}>Title</PipeLabel>
        <PipeInput
          id={titleId}
          ariaLabel="End screen title"
          value={end.title}
          readOnly={readOnly}
          placeholder="Thanks!"
          onChange={v => set(s => void (s.title = clip(v, 200)), 'end:title')}
        />
      </div>
      <div className="if-panel-pipe">
        <PipeLabel htmlFor={messageId}>Message</PipeLabel>
        <PipeInput
          id={messageId}
          ariaLabel="End screen message"
          describedBy={`${messageId}-hint`}
          multiline
          value={end.message}
          readOnly={readOnly}
          onChange={v => set(s => void (s.message = clip(v, 2000)), 'end:message')}
        />
        <p className="if-panel-hint" id={`${messageId}-hint`}>
          Type @ to thank people by name, e.g. “Thanks, @First name”.
        </p>
      </div>
      <SwitchRow
        label="Button under the message"
        checked={showButton}
        disabled={readOnly}
        onCheckedChange={v => {
          setShowButton(v);
          if (v) saveButton(btnLabel, btnUrl);
          else set(s => void (s.button = null));
        }}
      />
      {showButton && (
        <>
          <TextRow
            label="Button label"
            value={btnLabel}
            maxLength={40}
            disabled={readOnly}
            onChange={v => {
              setBtnLabel(v);
              saveButton(v, btnUrl);
            }}
          />
          <TextRow
            label="Button link"
            type="url"
            value={btnUrl}
            placeholder="https://example.com"
            disabled={readOnly}
            error={endButtonUrlError(btnUrl)}
            onChange={v => {
              setBtnUrl(v);
              saveButton(btnLabel, v);
            }}
          />
        </>
      )}
    </PanelSection>
  );
}

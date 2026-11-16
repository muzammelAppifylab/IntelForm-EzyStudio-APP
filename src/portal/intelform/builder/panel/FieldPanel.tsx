import {useId, useState} from 'react';

import type {FormField} from '../../../../lib/intelform/form/definition';
import {FIELD_GROUP_LABEL, FIELD_TYPE_META, FIELD_TYPES, type FieldType} from '../../../../lib/intelform/form/field-types';
import {FIELD_ICONS} from '../../../../form-types/icons';
import {FIELD_SETTINGS} from '../../../../form-types/settings';
import {Button, Combobox, Icon, IconButton, Modal, Tabs} from '../../../ui';
import {PipeInput} from '../pipe/PipeInput';
import {useBuilder, useBuilderStore} from '../store';
import type {FieldSettingsComponent} from '../type-ui';
import {LogicEditor} from './LogicEditor';
import {clip, questionNumber} from './model';
import {PanelSection, PipeLabel, SwitchRow, TextRow} from '../controls';
import './panel.css';

type PanelTab = 'settings' | 'logic';

/** Settings for the selected question (PRD "Common settings" + the type's own + its rule). */
export function FieldPanel({id}: {id: string}) {
  const store = useBuilderStore();
  const draft = useBuilder(s => s.doc.draft);
  const readOnly = useBuilder(s => s.readOnly);
  const [tab, setTab] = useState<PanelTab>('settings');
  const labelId = useId();
  const descriptionId = useId();
  const index = draft.fields.findIndex(f => f.id === id);
  const field = draft.fields[index];
  if (!field) return null;
  const meta = FIELD_TYPE_META[field.type];
  const isSection = field.type === 'section_break';
  const Settings = FIELD_SETTINGS[field.type] as FieldSettingsComponent;
  const update = (recipe: (f: FormField) => void, key?: string, label?: string) =>
    store.getState().updateField(id, recipe as never, key, label);
  const number = questionNumber(draft, index);

  return (
    <div className="if-field-panel">
      <div className="if-panel-head">
        <div className="if-panel-head-row">
          <div className="if-panel-head-text">
            <p className="if-panel-overline">{isSection ? 'Section break' : `Question ${number}`}</p>
            <h2>{isSection ? 'Section' : meta.label}</h2>
          </div>
          {!readOnly && (
            <div className="if-panel-row if-panel-actions">
              <IconButton icon="copy" size="sm" label="Duplicate this question" onClick={() => store.getState().duplicate(id)} />
              <IconButton
                icon="trash"
                size="sm"
                label="Delete this question"
                className="if-panel-danger"
                onClick={() => store.getState().requestDelete(id)}
              />
            </div>
          )}
        </div>
      </div>
      <Tabs<PanelTab>
        label="Question settings"
        value={tab}
        onChange={setTab}
        items={[
          {value: 'settings', label: 'Settings'},
          {
            value: 'logic',
            label: (
              <>
                Logic
                {field.logic && (
                  <>
                    <span className="if-panel-dot" aria-hidden="true" />
                    <span className="visually-hidden"> (has a rule)</span>
                  </>
                )}
              </>
            ),
          },
        ]}>
        {tab === 'logic' ? (
          <PanelSection title={isSection ? 'Show or hide this page' : 'Show or hide this question'}>
            <LogicEditor field={field} index={index} />
          </PanelSection>
        ) : (
          <>
            <div className="if-panel-type">
              <TypeSwitcher field={field} readOnly={readOnly} />
            </div>
            <PanelSection title={isSection ? 'Page' : 'Question'}>
              <div className="if-panel-pipe">
                <PipeLabel htmlFor={labelId}>{isSection ? 'Page title' : 'Label'}</PipeLabel>
                <PipeInput
                  id={labelId}
                  ariaLabel={isSection ? 'Page title' : 'Label'}
                  describedBy={`${labelId}-hint`}
                  value={field.label}
                  beforeIndex={index}
                  readOnly={readOnly}
                  placeholder={isSection ? 'Section title' : 'Type your question'}
                  onChange={v => update(f => void (f.label = clip(v, 500)), `label:${id}`, 'Edit label')}
                />
                <p className="if-panel-hint" id={`${labelId}-hint`}>
                  Type @ to show an earlier answer.
                </p>
              </div>
              <div className="if-panel-pipe">
                <PipeLabel htmlFor={descriptionId}>Description</PipeLabel>
                <PipeInput
                  id={descriptionId}
                  ariaLabel="Description"
                  multiline
                  value={field.description ?? ''}
                  beforeIndex={index}
                  readOnly={readOnly}
                  placeholder="Optional help text"
                  onChange={v =>
                    update(
                      f => {
                        if (v) f.description = clip(v, 2000);
                        else delete f.description;
                      },
                      `description:${id}`,
                      'Edit description'
                    )
                  }
                />
              </div>
              {meta.hasPlaceholder && (
                <TextRow
                  label="Placeholder"
                  value={field.placeholder ?? ''}
                  maxLength={200}
                  disabled={readOnly}
                  placeholder="Type your answer here"
                  onChange={v =>
                    update(f => {
                      if (v) f.placeholder = v;
                      else delete f.placeholder;
                    }, `placeholder:${id}`)
                  }
                />
              )}
              {!isSection && (
                <SwitchRow
                  label="Hide label"
                  description="Screen readers still read it."
                  checked={!!field.hideLabel}
                  disabled={readOnly}
                  onCheckedChange={v =>
                    update(f => {
                      if (v) f.hideLabel = true;
                      else delete f.hideLabel;
                    })
                  }
                />
              )}
            </PanelSection>

            {meta.stores && (
              <PanelSection title="Answer">
                <SwitchRow
                  label="Required"
                  description="Only while the question is shown."
                  checked={field.required}
                  disabled={readOnly}
                  onCheckedChange={v => update(f => void (f.required = v), undefined, 'Toggle required')}
                />
                {field.required && (
                  <TextRow
                    label="Message when left empty"
                    value={field.requiredError ?? ''}
                    maxLength={200}
                    disabled={readOnly}
                    placeholder="This question is required"
                    onChange={v =>
                      update(f => {
                        if (v) f.requiredError = v;
                        else delete f.requiredError;
                      }, `requiredError:${id}`)
                    }
                  />
                )}
              </PanelSection>
            )}

            <PanelSection title={`${meta.label} settings`}>
              <Settings
                field={field}
                readOnly={readOnly}
                onChange={(patch, key) => update(f => void Object.assign(f.props as object, patch), key, 'Change setting')}
              />
            </PanelSection>
          </>
        )}
      </Tabs>
    </div>
  );
}

const TYPE_OPTIONS = FIELD_TYPES.map(t => ({
  value: t,
  label: FIELD_TYPE_META[t].label,
  group: FIELD_GROUP_LABEL[FIELD_TYPE_META[t].group],
}));

function TypeSwitcher({field, readOnly}: {field: FormField; readOnly: boolean}) {
  const store = useBuilderStore();
  const responses = useBuilder(s => s.meta.responses);
  const [pending, setPending] = useState<FieldType | null>(null);
  const id = useId();

  function choose(type: FieldType) {
    if (type === field.type) return;
    // Old answers belong to the old type: with responses, the question gets a new id.
    if (responses > 0) setPending(type);
    else store.getState().setType(field.id, type, false);
  }

  return (
    <>
      <span className="if-panel-type-icon">
        <Icon name={FIELD_ICONS[field.type]} size={16} />
      </span>
      <label htmlFor={id} className="visually-hidden">
        Question type
      </label>
      <Combobox
        id={id}
        value={field.type}
        disabled={readOnly}
        searchLabel="Find a question type"
        options={TYPE_OPTIONS}
        onChange={v => choose(v as FieldType)}
      />
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        size="sm"
        title={`Change to ${pending ? FIELD_TYPE_META[pending].label : ''}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep {FIELD_TYPE_META[field.type].label}
            </Button>
            <Button
              onClick={() => {
                if (pending) store.getState().setType(field.id, pending, true);
                setPending(null);
              }}>
              Change type
            </Button>
          </>
        }>
        <p className="modal-text">
          This form already has {responses.toLocaleString()} {responses === 1 ? 'response' : 'responses'}. The changed question is saved
          as a new question, so earlier answers stay with the old one in Responses. Rules and answer chips that used it move to the new
          one; check that they still make sense.
        </p>
      </Modal>
    </>
  );
}

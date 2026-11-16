import {useEffect, useRef, useState} from 'react';
import {Link} from '@tanstack/react-router';

import {Button, buttonClass, Icon, StatusBadge, Tooltip} from '../../ui';
import {cn} from '../lib/utils';
import {PreviewDialog} from './PreviewDialog';
import {PublishButton} from './PublishButton';
import {useBuilder, useBuilderStore} from './store';
import {TABS, type TabId} from './tabs';

/**
 * The builder's header, the same on every tab, in three columns so the tabs stay centred
 * whatever the title's length: the way back and the editable title | the five tabs | a Draft
 * badge (drafts only), the save state, Preview and Publish. Unpublished changes show on the
 * Publish button ("Publish changes"), not as a badge.
 */
export function BuilderHeader({tab}: {tab: TabId | null}) {
  const formId = useBuilder(s => s.meta.id);
  const status = useBuilder(s => s.meta.status);
  const responses = useBuilder(s => s.meta.responses);
  const readOnly = useBuilder(s => s.readOnly);
  const [preview, setPreview] = useState(false);

  return (
    <header className="if-builder-head">
      <div className="if-head-card if-head-start">
        <Link to="/forms" className={buttonClass({variant: 'ghost', size: 'sm'})} aria-label="All forms">
          <Icon name="arrow-left" size={16} />
          <span className="if-wide-only">Forms</span>
        </Link>
        <span aria-hidden="true" className="if-head-divider" />
        <TitleInput />
      </div>

      <nav aria-label="Form sections" className="if-head-card if-builder-tabs">
        {TABS.map(t => (
          <Link
            key={t.id}
            to={t.to}
            params={{formId}}
            className={cn('if-builder-tab', t.id === tab && 'is-active')}
            aria-current={t.id === tab ? 'page' : undefined}>
            <Icon name={t.icon} size={16} />
            <span className="if-tab-label">{t.label}</span>
            {t.id === 'responses' && responses > 0 && <span className="if-tab-count">{responses.toLocaleString()}</span>}
          </Link>
        ))}
      </nav>

      <div className="if-head-card if-head-end">
        {status === 'draft' && <StatusBadge tone="neutral">Draft</StatusBadge>}
        {status === 'closed' && <StatusBadge tone="warning">Closed</StatusBadge>}
        <SaveState />
        <Button variant="secondary" size="sm" icon="eye" onClick={() => setPreview(true)}>
          Preview
        </Button>
        {!readOnly && <PublishButton />}
      </div>
      <PreviewDialog open={preview} onOpenChange={setPreview} />
    </header>
  );
}

function TitleInput() {
  const title = useBuilder(s => s.doc.title);
  const readOnly = useBuilder(s => s.readOnly);
  const store = useBuilderStore();
  const [text, setText] = useState(title);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(title);
  }, [title]);
  const commit = (v: string) => {
    if (v.trim()) store.getState().commit('Rename form', d => void (d.title = v.slice(0, 200)), 'title');
  };
  return (
    <input
      aria-label="Form title"
      title={text}
      value={text}
      readOnly={readOnly}
      maxLength={200}
      className="if-title-input"
      onFocus={() => (focused.current = true)}
      onChange={e => {
        setText(e.target.value);
        commit(e.target.value);
      }}
      onBlur={e => {
        focused.current = false;
        e.currentTarget.scrollLeft = 0;
        if (!text.trim()) setText(title);
      }}
      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

const SAVE_TEXT = {saving: 'Saving…', pending: 'Saving…', offline: 'Offline, retrying', error: 'Not saved', saved: 'Saved'} as const;

function SaveState() {
  const save = useBuilder(s => s.save);
  const readOnly = useBuilder(s => s.readOnly);
  if (readOnly) return <span className="if-save-state">View only</span>;
  const {status, error} = save;
  // Saving and saved are announced (and shown quietly); a failed or offline save stands out.
  const failing = status === 'error' || status === 'offline';
  const node = (
    <span role="status" aria-live="polite" data-save-status={status} className={cn('if-save-state', failing && 'is-failing')} tabIndex={failing ? 0 : undefined}>
      {status === 'saving' || status === 'pending' ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <Icon name={status === 'offline' ? 'cloud-off' : status === 'error' ? 'alert' : 'check'} size={14} />
      )}
      <span className="if-save-text">{SAVE_TEXT[status]}</span>
    </span>
  );
  if (!error || !failing) return node;
  return <Tooltip content={error.message}>{node}</Tooltip>;
}

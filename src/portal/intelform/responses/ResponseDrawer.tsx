import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';

import {RichText} from '../../../respondent/rich/RichText';
import {Button, DefinitionList, Drawer, ErrorNote, IconButton, LoadingBlock, Tooltip} from '../../ui';
import {useCan} from '../lib/can';
import {responseDetailQuery, responsesListPrefix, type ResponsesPage} from '../queries/responses';
import {useConfirmDelete} from './ConfirmDelete';
import {countryLabel, deviceLabel, formatDateTime, formatDuration, formatNumber} from './format';
import {navKey, type TableState} from './state';

/**
 * One response (legacy ResponseDrawer.tsx): answers with labels as submitted, metadata,
 * previous / next within the table's filters (buttons, ←/→ and J/K), delete with confirm.
 * Opened by `?response=<id>`, which owner notification emails link to.
 */
export function ResponseDrawer({
  formId,
  responseId,
  table,
  onNavigate,
  onClose,
}: {
  formId: string;
  responseId: string | null;
  table: TableState;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const open = !!responseId;
  const {data, error, isPlaceholderData} = useQuery({...responseDetailQuery(formId, responseId ?? '', table), enabled: open});
  const canDelete = useCan('deleteResponses');
  const askDelete = useConfirmDelete(formId);
  const confirming = useRef(false);
  // While the next response loads, the previous one stays on screen (aria-busy).
  const detail = open ? data : undefined;
  // "3 of 120" from the table pages already loaded (the server no longer counts per open).
  const qc = useQueryClient();
  const position = (() => {
    if (!detail) return '';
    for (const [, page] of qc.getQueriesData<ResponsesPage>({queryKey: responsesListPrefix(formId, table)})) {
      const i = page?.rows.findIndex(r => r.id === detail.id) ?? -1;
      if (!page || i < 0) continue;
      const at = (page.page - 1) * page.pageSize + i;
      return `${formatNumber(at + 1)} of ${formatNumber(page.total)}${page.totalCapped ? '+' : ''} · `;
    }
    return '';
  })();

  useEffect(() => {
    if (!open || !detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (confirming.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const dir = navKey(e.key);
      const to = dir === 'prev' ? detail.prevId : dir === 'next' ? detail.nextId : null;
      if (!to) return;
      e.preventDefault();
      onNavigate(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, detail, onNavigate]);

  const remove = async () => {
    if (!detail) return;
    confirming.current = true;
    try {
      if (await askDelete([detail.id])) {
        const go = detail.nextId ?? detail.prevId;
        if (go) onNavigate(go);
        else onClose();
      }
    } finally {
      confirming.current = false;
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Response"
      description={
        detail ? `${position}${formatDateTime(detail.submittedAt)}` : 'Loading…'
      }
      footer={
        <div className="responses-drawer-nav">
          <Tooltip content="Previous (← or K)">
            <IconButton
              icon="chevron-left"
              variant="secondary"
              size="sm"
              label="Previous response"
              aria-keyshortcuts="ArrowLeft K"
              disabled={!detail?.prevId}
              onClick={() => detail?.prevId && onNavigate(detail.prevId)}
            />
          </Tooltip>
          <Tooltip content="Next (→ or J)">
            <IconButton
              icon="chevron-right"
              variant="secondary"
              size="sm"
              label="Next response"
              aria-keyshortcuts="ArrowRight J"
              disabled={!detail?.nextId}
              onClick={() => detail?.nextId && onNavigate(detail.nextId)}
            />
          </Tooltip>
          {canDelete && detail && (
            <Button variant="danger" size="sm" icon="trash" className="responses-drawer-delete" onClick={() => void remove()}>
              Delete
            </Button>
          )}
        </div>
      }>
      <div className="responses-drawer" aria-busy={isPlaceholderData || (open && !detail) || undefined}>
        {error && !detail ? (
          <ErrorNote error={error} />
        ) : !detail ? (
          <LoadingBlock rows={5} />
        ) : (
          <>
            <dl className="responses-drawer-answers">
              {detail.answers.map(a => (
                <div key={a.fieldId}>
                  <dt>{a.label}</dt>
                  <dd>
                    {a.type === 'signature' && a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="responses-signature">
                        <img src={a.url} alt={`Signature for “${a.label}”`} />
                      </a>
                    ) : a.html ? (
                      <RichText html={a.html} inline={a.type === 'short_text'} />
                    ) : a.text ? (
                      a.text
                    ) : (
                      <span className="muted">No answer</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <section aria-labelledby="response-meta" className="responses-drawer-meta">
              <h3 id="response-meta" className="responses-overline">
                Details
              </h3>
              <DefinitionList
                items={[
                  {label: 'Submitted', value: formatDateTime(detail.submittedAt)},
                  {label: 'Time taken', value: formatDuration(detail.durationMs)},
                  {label: 'Device', value: deviceLabel(detail.device)},
                  {label: 'Browser', value: detail.browser ?? '–'},
                  {label: 'Country', value: countryLabel(detail.country)},
                  {label: 'Form version', value: `Version ${detail.formVersion}`},
                ]}
              />
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}

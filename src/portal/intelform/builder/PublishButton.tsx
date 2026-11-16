import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';

import type {PublishResponse} from '../../../lib/intelform/api-forms';
import type {FormDefinition} from '../../../lib/intelform/form/definition';
import {lintLogic, lintOnePerEmail} from '../../../lib/intelform/form/logic';
import {siteFetch} from '../../../platform/browser';
import {Button, Icon, Modal, useToast} from '../../ui';
import {ApiRequestError, errorMessage, OFFLINE_MESSAGE} from '../lib/api';
import {fieldName} from './ops';
import {useBuilder, useBuilderStore} from './store';

export interface PublishProblem {
  message: string;
  fieldId?: string;
}

export class PublishBlocked extends Error {
  readonly problems: PublishProblem[];
  constructor(problems: PublishProblem[]) {
    super(problems[0]?.message ?? 'Publishing is blocked');
    this.name = 'PublishBlocked';
    this.problems = problems;
  }
}

/**
 * The integrity check the server repeats (and enforces with a 422) before a draft goes live: at
 * least one question, no broken logic, and a valid "one response per email" field.
 */
export function publishProblems(def: FormDefinition, settings?: {onePerEmail: boolean; onePerEmailFieldId: string | null}): PublishProblem[] {
  const out: PublishProblem[] = [];
  if (def.fields.filter(f => f.type !== 'section_break').length === 0) out.push({message: 'Add at least one question before you publish.'});
  for (const issue of lintLogic(def)) out.push({message: issue.message, fieldId: issue.fieldId});
  if (settings) for (const issue of lintOnePerEmail(def, settings)) out.push({message: issue.message, fieldId: issue.fieldId});
  return out;
}

type IssueLike = {message?: unknown; fieldId?: unknown};

/**
 * Turns a failed publish answer into the error to throw: a 422 becomes `PublishBlocked` with
 * the server's issue list (top level `issues`, the template's `problem()` shape, or legacy
 * `error.issues`); anything else an `ApiRequestError`.
 */
export function publishFailure(status: number, body: unknown): PublishBlocked | ApiRequestError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>) : null;
  const code = typeof b.error === 'string' ? b.error : typeof nested?.code === 'string' ? nested.code : 'unknown';
  const message =
    typeof b.message === 'string' ? b.message : typeof nested?.message === 'string' ? nested.message : 'Publishing failed. Try again.';
  if (status === 422) {
    const raw = (Array.isArray(b.issues) ? b.issues : Array.isArray(nested?.issues) ? nested.issues : []) as IssueLike[];
    const problems = raw
      .filter(i => i && typeof i.message === 'string')
      .map(i => ({message: i.message as string, ...(typeof i.fieldId === 'string' ? {fieldId: i.fieldId} : {})}));
    return new PublishBlocked(problems.length ? problems : [{message}]);
  }
  return new ApiRequestError(status, {code, message});
}

/** POST /site-api/forms/:id/publish, keeping the 422 issue list (`api()` drops extra keys). */
async function postPublish(id: string): Promise<PublishResponse> {
  let res: Response;
  try {
    res = await siteFetch(`/site-api/forms/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: '{}',
    });
  } catch {
    throw new ApiRequestError(0, {code: 'offline', message: OFFLINE_MESSAGE});
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return body as PublishResponse;
  throw publishFailure(res.status, body);
}

/** Where a problem is, in words ("Start screen", "Email"), or null. */
function placeOf(def: FormDefinition, id?: string): string | null {
  if (!id) return null;
  if (id === 'startScreen') return 'Start screen';
  if (id === 'endScreen') return 'End screen';
  const f = def.fields.find(x => x.id === id);
  return f ? fieldName(def, f) : null;
}

/**
 * Publish: the integrity check runs here first (the same check the server repeats), then
 * pending edits are saved and the draft becomes a new version.
 */
export function PublishButton() {
  const store = useBuilderStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useBuilder(s => s.meta.status);
  const hasUnpublished = useBuilder(s => s.meta.hasUnpublished);
  const saveStatus = useBuilder(s => s.save.status);
  const draft = useBuilder(s => s.doc.draft);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<PublishProblem[] | null>(null);

  const upToDate = status !== 'draft' && !hasUnpublished && saveStatus === 'saved';

  async function publish() {
    const s0 = store.getState();
    const local = publishProblems(s0.doc.draft, s0.settings);
    if (local.length) return setProblems(local);
    setBusy(true);
    try {
      await store.getState().flush();
      if (store.queue.dirty)
        throw new Error(store.getState().save.error?.message ?? 'Your latest changes couldn’t be saved, so nothing was published. Try again.');
      const wasLive = store.getState().meta.publishedVersion !== null;
      const res = await postPublish(store.getState().meta.id);
      // Publishing moves the revision on; rebase so the next autosave isn't seen as a conflict.
      store.queue.rebase(res.revision);
      store.getState().setMeta({
        status: res.status,
        publishedVersion: res.version,
        publishedAt: res.publishedAt,
        hasUnpublished: false,
        responses: res.responses,
      });
      void queryClient.invalidateQueries({queryKey: ['intelform', 'forms'], refetchType: 'none'});
      toast.success(wasLive ? 'Changes published' : res.status === 'closed' ? 'Published. The form is still closed.' : 'Published. Your form is live.');
    } catch (err) {
      if (err instanceof PublishBlocked) setProblems(err.problems);
      else toast.danger(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function goTo(fieldId?: string) {
    setProblems(null);
    if (!fieldId) return;
    const s = store.getState();
    s.select(fieldId === 'startScreen' ? 'start' : fieldId === 'endScreen' ? 'end' : fieldId);
    void navigate({to: '/forms/$formId/build', params: {formId: s.meta.id}}).then(() =>
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${store.getState().selection}"]`)?.focus())
    );
  }

  return (
    <>
      <Button icon="rocket" onClick={() => void publish()} pending={busy} pendingLabel="Publishing…" disabled={upToDate} size="sm">
        {upToDate ? 'Published' : status === 'draft' ? 'Publish' : 'Publish changes'}
      </Button>
      <Modal
        open={problems !== null}
        onClose={() => setProblems(null)}
        title="Fix these before you publish"
        description="Your form is saved as a draft. Publishing is blocked until every problem below is fixed."
        footer={<Button onClick={() => setProblems(null)}>Close</Button>}>
        <ul className="if-problems" aria-label="Problems">
          {problems?.map((p, i) => {
            const where = placeOf(draft, p.fieldId);
            return (
              <li key={i} className="if-problem">
                <Icon name="alert" size={16} />
                <div className="if-problem-text">
                  <span>{p.message}</span>
                  {where && (
                    <button type="button" className="if-link-button" onClick={() => goTo(p.fieldId)}>
                      Go to {where}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Modal>
    </>
  );
}

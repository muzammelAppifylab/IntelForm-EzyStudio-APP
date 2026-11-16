import {lazy, type RefObject, Suspense, useEffect, useId, useMemo, useRef, useState} from 'react';

import type {PublicFormLive, PublicFormResponse} from '../lib/intelform/api-public';
import {SYSTEM_LABELS} from '../lib/intelform/form/labels';
import {defaultTheme} from '../lib/intelform/form/theme-core';
import {
  fetchForm,
  newUuid,
  PublicApiError,
  rememberBrowserToken,
  sendEvent,
  sessionToken,
  storedBrowserToken,
  submitResponse,
  unlockForm,
} from './api';
import {EMBED_MESSAGES, embedOptions, type EmbedOptions} from './embed';
import {FormRenderer, type SubmitResult} from './FormRenderer';
import {submitFailure} from './submit-result';
import type {TurnstileHandle} from './lazy/Turnstile';
import {MessageScreen, PasswordGate} from './screens';
import {FormShell} from './Shell';
import {prepareSignatureAnswers, SignatureUploadError} from './upload';

const TurnstileWidget = lazy(() => import('./lazy/Turnstile'));

/**
 * The public form at /f/<slug>/ (src/pages/f/[slug].astro renders it as a client-only island
 * with the form JSON as `initial`, so the first paint needs no second request): the password
 * gate, the closed message, a 404, or the live form wired to the submit API, the funnel events,
 * Turnstile, signature uploads and one-response-per-browser. Embedding: `?embed=1` (inline,
 * posts its height to the parent), `?embed=popup`, `&transparent=1`, `&hideTitle=1` (./embed.ts).
 */
export type Loaded = PublicFormResponse | {status: 'missing'} | {status: 'error'};

export function PublicForm({slug: initialSlug, initial, search}: {slug: string; initial?: Loaded | null; search: string}) {
  const [slug, setSlug] = useState(initialSlug);
  const [data, setData] = useState<Loaded | null>(initial ?? null);
  const unlock = useRef<string | null>(null);
  /** Answers kept across a reload after the form was republished (version_unknown on submit). */
  const carried = useRef<Record<string, unknown> | null>(null);
  const opts = useMemo(() => embedOptions(search), [search]);

  useEffect(() => {
    if (data && data.status !== 'moved') return;
    if (data?.status === 'moved') {
      const next = data.redirectTo;
      try {
        history.replaceState(history.state, '', `/f/${encodeURIComponent(next)}/${location.search}`);
      } catch {
        // sandboxed
      }
      setSlug(next);
      setData(null);
      return;
    }
    let alive = true;
    fetchForm(slug, unlock.current)
      .then(d => alive && setData(d))
      .catch(err => alive && setData({status: err instanceof PublicApiError && err.status === 404 ? 'missing' : 'error'}));
    return () => {
      alive = false;
    };
  }, [slug, data]);

  // The tab title.
  useEffect(() => {
    if (!data || !('title' in data)) return;
    document.title = data.settings.seoTitle || data.title;
  }, [data]);

  useEmbedBridge(opts.embed);

  const shellMode = opts.embed === 'inline' ? 'embed' : 'page';
  if (!data) return <div aria-busy="true" className="rf-loading" />;
  if (data.status === 'moved') return null;
  if (data.status === 'missing' || data.status === 'error') {
    const missing = data.status === 'missing';
    return (
      <FormShell theme={defaultTheme()} mode={shellMode}>
        <div role="main" className="rf-main">
          <MessageScreen
            center={false}
            title={missing ? SYSTEM_LABELS.formMissingTitle : SYSTEM_LABELS.loadErrorTitle}
            message={missing ? SYSTEM_LABELS.formMissing : SYSTEM_LABELS.loadError}
          />
        </div>
      </FormShell>
    );
  }

  const center = data.theme.alignment === 'center';
  if (data.status === 'closed') {
    return (
      <FormShell theme={data.theme} mode={shellMode} transparent={opts.transparent}>
        <div role="main" className="rf-main">
          <MessageScreen center={center} title={data.message} />
        </div>
      </FormShell>
    );
  }
  if (data.status === 'locked') {
    return (
      <FormShell theme={data.theme} mode={shellMode} transparent={opts.transparent}>
        <div role="main" className="rf-main">
          <PasswordGate
            title={data.title}
            labels={SYSTEM_LABELS}
            center={center}
            onUnlock={async password => {
              try {
                const r = await unlockForm(slug, password);
                unlock.current = r.token;
                setData(r.form);
                return null;
              } catch (err) {
                return err instanceof PublicApiError ? (err.fields.password?.[0] ?? err.message) : SYSTEM_LABELS.submitError;
              }
            }}
          />
        </div>
      </FormShell>
    );
  }
  return (
    <LiveForm
      key={data.versionId}
      form={data}
      slug={slug}
      opts={opts}
      unlockToken={unlock}
      initialAnswers={carried.current}
      onLocked={() => setData(null)}
      onOutdated={answers => {
        // Refetch the latest version in place (setData(null) reloads it) and start from these answers.
        carried.current = answers;
        setData(null);
      }}
    />
  );
}

function LiveForm({
  form,
  slug,
  opts,
  unlockToken,
  initialAnswers,
  onLocked,
  onOutdated,
}: {
  form: PublicFormLive;
  slug: string;
  opts: EmbedOptions;
  unlockToken: RefObject<string | null>;
  initialAnswers: Record<string, unknown> | null;
  onLocked: () => void;
  onOutdated: (answers: Record<string, unknown>) => void;
}) {
  const labels = SYSTEM_LABELS;
  const turnstile = useRef<TurnstileHandle>(null);
  const renderToken = form.renderToken;
  const [already] = useState(() => (form.settings.onePerBrowser ? storedBrowserToken(form.id) : null));
  const browserToken = useMemo(() => storedBrowserToken(form.id) ?? newUuid(), [form.id]);
  const [closed, setClosed] = useState<string | null>(null);
  const shellMode = opts.embed === 'inline' ? 'embed' : 'page';
  const center = form.theme.alignment === 'center';

  useEffect(() => {
    sendEvent(slug, 'view', sessionToken(form.id));
  }, [slug, form.id]);

  if (already || closed) {
    return (
      <FormShell theme={form.theme} mode={shellMode} transparent={opts.transparent}>
        <div role="main" className="rf-main">
          <MessageScreen center={center} title={closed ?? labels.alreadyResponded} />
        </div>
      </FormShell>
    );
  }

  const onSubmit = async (answers: Record<string, unknown>, meta: {startedAt: number; ttc: Record<string, number>}): Promise<SubmitResult> => {
    let turnstileToken: string | undefined;
    if (form.turnstileSiteKey) {
      try {
        turnstileToken = await turnstile.current?.getToken();
      } catch {
        turnstile.current?.reset();
        return {ok: false, errors: {}, message: labels.humanCheckFailed};
      }
    }
    // A honeypot input exists in the DOM for bots that fill every field.
    const hp = (document.querySelector<HTMLInputElement>('input[data-if-hp]')?.value ?? '').slice(0, 2000);
    let sent: Record<string, unknown>;
    try {
      // Drawn signatures go to storage first; the submit carries their {fileId, token}.
      sent = await prepareSignatureAnswers(form.definition.fields, answers, form.id);
    } catch (err) {
      turnstile.current?.reset();
      if (err instanceof SignatureUploadError && err.fieldId) return {ok: false, errors: {[err.fieldId]: err.message}};
      return {ok: false, errors: {}, message: err instanceof SignatureUploadError ? err.message : labels.submitError};
    }
    try {
      const r = await submitResponse(slug, {
        formVersionId: form.versionId,
        answers: sent,
        startedAt: meta.startedAt,
        ttc: meta.ttc,
        renderToken,
        hp: hp || undefined,
        turnstileToken,
        unlockToken: unlockToken.current ?? undefined,
        browserToken,
      });
      if (form.settings.onePerBrowser) rememberBrowserToken(form.id, browserToken);
      return {ok: true, redirectUrl: r.redirectUrl};
    } catch (err) {
      turnstile.current?.reset();
      return submitFailure(err, {
        onClosed: setClosed,
        onLocked,
        reload: () => onOutdated(answers),
      });
    }
  };

  return (
    <FormRenderer
      definition={form.definition}
      theme={form.theme}
      mode="live"
      stepSound={form.settings.stepSound}
      title={form.title}
      embed={opts.embed}
      hideTitle={opts.hideTitle}
      transparent={opts.transparent}
      manageDocumentTitle
      onStart={() => sendEvent(slug, 'start', sessionToken(form.id))}
      onSubmit={onSubmit}
      initialAnswers={initialAnswers}
      footer={
        <>
          <Honeypot />
          {form.turnstileSiteKey && (
            <Suspense fallback={null}>
              <TurnstileWidget ref={turnstile} siteKey={form.turnstileSiteKey} />
            </Suspense>
          )}
        </>
      }
    />
  );
}

/** Off-screen bait field: hidden from people and assistive tech, filled by naive bots. */
function Honeypot() {
  const name = `website_${useId().replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div aria-hidden="true" className="rf-honeypot">
      <label>
        Leave this empty
        <input data-if-hp type="text" name={name} tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

/**
 * Inside an iframe: post our height to the parent (`?embed=1`) so embed.js can size the frame,
 * and ask it to close on Escape (`?embed=popup`). We only ever send a height or "close": the
 * host page is unknown, so the message goes to '*' and carries nothing else.
 */
function useEmbedBridge(embed: EmbedOptions['embed']) {
  useEffect(() => {
    if (!embed || window.parent === window) return;
    const post = (msg: object) => window.parent.postMessage(msg, '*');
    let ro: ResizeObserver | null = null;
    if (embed === 'inline') {
      const root = document.getElementById('rf-root') ?? document.body;
      let last = 0;
      ro = new ResizeObserver(() => {
        const height = Math.ceil(root.getBoundingClientRect().height);
        if (height !== last) {
          last = height;
          post({type: EMBED_MESSAGES.resize, height});
        }
      });
      ro.observe(root);
    }
    const onKey = (e: KeyboardEvent) => {
      if (embed === 'popup' && e.key === 'Escape' && !e.defaultPrevented) post({type: EMBED_MESSAGES.close});
    };
    document.addEventListener('keydown', onKey);
    return () => {
      ro?.disconnect();
      document.removeEventListener('keydown', onKey);
    };
  }, [embed]);
}

export default PublicForm;

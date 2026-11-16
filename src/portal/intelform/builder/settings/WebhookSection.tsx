import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Fragment, useState} from 'react';

import type {WebhookSecretResponse, WebhookSendResult} from '../../../../lib/intelform/api-builder';
import {Badge, Button, CopyField, IconButton, Notice, Spinner, Switch, useConfirm, useToast} from '../../../ui';
import {api, errorMessage} from '../../lib/api';
import {useBuilder} from '../store';
import {useSettingsSave} from './hooks';
import {headerError, headersToSave, isWebhookUrl, webhookSummary, type WebhookHeader} from './logic';
import {type DeliveryRow, webhookInfoQuery, webhookKey, webhookLogQuery, webhookPath} from './queries';
import {Hint, SettingsCard, TextRow} from './shared';

type SendAnswer = WebhookSendResult & {queued?: boolean};

const MAX_HEADERS = 20;

/** Webhook: URL, headers, signing secret, a test, and the delivery log with Resend. */
export function WebhookSection() {
  const formId = useBuilder(s => s.meta.id);
  const webhook = useBuilder(s => s.settings.webhook);
  const readOnly = useBuilder(s => s.readOnly);
  const redacted = useBuilder(s => s.settings.webhookRedacted);
  const {save, errors} = useSettingsSave();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const base = webhookPath(formId);
  const [url, setUrl] = useState(webhook.url ?? '');
  const [headers, setHeaders] = useState<WebhookHeader[]>(webhook.headers);
  const [secret, setSecret] = useState<string | null>(null);

  // The saved headers changed (another tab, the server's answer): show those.
  const [savedHeaders, setSavedHeaders] = useState(webhook.headers);
  if (savedHeaders !== webhook.headers) {
    setSavedHeaders(webhook.headers);
    setHeaders(webhook.headers);
  }

  // Redacted data (a viewer promoted mid-session) stays read-only: saving it would blank the stored headers.
  const editable = !readOnly && !redacted;
  const info = useQuery({...webhookInfoQuery(formId), enabled: editable});
  const log = useQuery({...webhookLogQuery(formId), enabled: editable});
  const refreshLog = () => queryClient.invalidateQueries({queryKey: [...webhookKey(formId), 'log']});
  // A rotate always sets the secret; a test creates one the first time.
  const markSecret = () => queryClient.setQueryData([...webhookKey(formId), 'info'], {hasSecret: true});

  const rotate = useMutation({
    mutationFn: () => api<WebhookSecretResponse>(`${base}/secret`, {method: 'POST'}),
    onSuccess: r => {
      setSecret(r.secret);
      markSecret();
    },
    onError: e => toast.danger(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => api<SendAnswer>(`${base}/test`, {method: 'POST'}),
    onSuccess: r => {
      if (r.queued) toast.info('Test sent. Its result shows in the delivery log in a moment.');
      else if (r.ok) toast.success(`Test sent: the endpoint answered ${r.statusCode} in ${r.durationMs} ms`);
      else toast.danger(`Test failed: ${r.error ?? `status ${r.statusCode}`}`);
      markSecret();
      void refreshLog();
    },
    onError: e => toast.danger(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: (id: string) => api<SendAnswer>(`${base}/deliveries/${encodeURIComponent(id)}/resend`, {method: 'POST'}),
    onSuccess: r => {
      if (r.queued) toast.info('Delivery resent. Its result shows in the log in a moment.');
      else if (r.ok) toast.success('Delivery resent');
      else toast.danger(`Resend failed: ${r.error ?? `status ${r.statusCode}`}`);
      void refreshLog();
    },
    onError: e => toast.danger(errorMessage(e)),
  });

  function saveHeaders(next: WebhookHeader[]) {
    const clean = headersToSave(next);
    if (clean) void save({webhook: {headers: clean}});
  }

  const urlValid = isWebhookUrl(url);
  const hasSecret = info.data?.hasSecret ?? false;

  return (
    <SettingsCard
      id="webhook"
      title="Webhook"
      description="Sends each completed response as JSON to your URL, signed with HMAC-SHA256 (Standard Webhooks), so your server can check it came from here.">
      {!editable ? (
        <p className="if-row-hint">{webhookSummary(webhook, redacted)}</p>
      ) : (
        <>
          <TextRow
            label="Endpoint URL"
            type="url"
            inputMode="url"
            placeholder="https://example.com/hooks/intelform"
            value={url}
            error={errors['webhook.url'] ?? errors.webhook ?? (url && !urlValid ? 'Enter a full link starting with https://' : null)}
            onChange={v => {
              setUrl(v);
              if (!v.trim()) void save({webhook: {url: null, enabled: false}});
              else if (isWebhookUrl(v)) void save({webhook: {url: v.trim()}});
            }}
          />
          <Switch
            label="Send responses to this URL"
            description={urlValid ? 'One attempt per response. Failed deliveries can be resent from the log below.' : 'Add a URL first.'}
            checked={webhook.enabled}
            disabled={!webhook.url}
            onChange={v => void save({webhook: {enabled: v}}, v ? 'Webhook on' : 'Webhook off')}
          />

          <fieldset className="if-fieldset">
            <legend>Custom headers</legend>
            <Hint>For example an API key your endpoint expects. Up to {MAX_HEADERS}.</Hint>
            {headers.map((h, i) => {
              const problem = headerError(h);
              return (
                <div key={i} className="if-header-row">
                  <div className="if-header-inputs field">
                    <input
                      aria-label={`Header ${i + 1} name`}
                      placeholder="Header name"
                      className="if-mono"
                      value={h.key}
                      aria-invalid={problem ? true : undefined}
                      onChange={e => setHeaders(headers.map((x, j) => (j === i ? {...x, key: e.target.value} : x)))}
                      onBlur={() => saveHeaders(headers)}
                    />
                    <input
                      aria-label={`Header ${i + 1} value`}
                      placeholder="Value"
                      className="if-mono"
                      value={h.value}
                      onChange={e => setHeaders(headers.map((x, j) => (j === i ? {...x, value: e.target.value} : x)))}
                      onBlur={() => saveHeaders(headers)}
                    />
                    <IconButton
                      icon="trash"
                      label={`Remove header ${h.key || i + 1}`}
                      onClick={() => {
                        const next = headers.filter((_, j) => j !== i);
                        setHeaders(next);
                        saveHeaders(next);
                      }}
                    />
                  </div>
                  {problem && <p className="field-error">{problem}</p>}
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={headers.length >= MAX_HEADERS}
              onClick={() => setHeaders([...headers, {key: '', value: ''}])}>
              Add header
            </Button>
          </fieldset>

          <div className="if-group">
            <span className="if-row-label">Signing secret</span>
            {secret ? (
              <>
                <Notice tone="warning">Copy this secret now. For your security it won’t be shown again.</Notice>
                <CopyField label="Signing secret" value={secret} />
              </>
            ) : (
              <Hint>
                {hasSecret
                  ? 'A secret is set. It is only shown when it is created; regenerate it if you lost it.'
                  : 'No secret yet. One is created with the first delivery, or generate it now to set up your endpoint.'}
              </Hint>
            )}
            <div className="if-row-actions">
              <Button
                variant="secondary"
                size="sm"
                icon="key"
                pending={rotate.isPending}
                onClick={() => {
                  if (!hasSecret) return rotate.mutate();
                  void confirm({
                    title: 'Regenerate the signing secret?',
                    body: 'Your endpoint will reject deliveries until you give it the new secret. The old one stops working right away.',
                    confirmLabel: 'Regenerate',
                    action: () => rotate.mutateAsync(),
                  });
                }}>
                {hasSecret ? 'Regenerate secret' : 'Generate secret'}
              </Button>
              <Button variant="secondary" size="sm" icon="send" disabled={!webhook.url} pending={test.isPending} onClick={() => test.mutate()}>
                Send test
              </Button>
            </div>
          </div>

          <DeliveryLog
            rows={log.data?.deliveries}
            loading={log.isPending}
            error={log.error}
            onResend={id => resend.mutate(id)}
            resending={resend.isPending ? resend.variables : undefined}
          />
        </>
      )}
    </SettingsCard>
  );
}

const when = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'medium'});

function DeliveryLog({
  rows,
  loading,
  error,
  onResend,
  resending,
}: {
  rows: DeliveryRow[] | undefined;
  loading: boolean;
  error: Error | null;
  onResend: (id: string) => void;
  resending?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="if-group">
      <div className="if-row-between">
        <span className="if-row-label">Delivery log</span>
        <span className="if-row-hint">The last 100 attempts</span>
      </div>
      {loading ? (
        <Spinner label="Loading the delivery log…" showLabel />
      ) : error ? (
        <Notice tone="danger">{errorMessage(error)}</Notice>
      ) : !rows?.length ? (
        <p className="if-empty-box">No deliveries yet. Send a test to check your endpoint.</p>
      ) : (
        <div className="if-log" role="region" aria-label="Delivery log" tabIndex={0}>
          <table className="if-log-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Details</span>
                </th>
                <th scope="col">Time</th>
                <th scope="col">Status</th>
                <th scope="col" className="if-num">
                  Duration
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <Fragment key={d.id}>
                  <tr>
                    <td className="if-log-toggle">
                      <IconButton
                        icon={open === d.id ? 'chevron-down' : 'chevron-right'}
                        size="sm"
                        label={open === d.id ? 'Hide response body' : 'Show response body'}
                        aria-expanded={open === d.id}
                        onClick={() => setOpen(open === d.id ? null : d.id)}
                      />
                    </td>
                    <td className="if-nowrap">{when.format(new Date(d.createdAt))}</td>
                    <td>
                      <span className="if-badges">
                        {d.pending ? (
                          <Badge tone="info">Sending</Badge>
                        ) : (
                          <Badge tone={d.ok ? 'success' : 'danger'}>{d.statusCode ?? 'No answer'}</Badge>
                        )}
                        {d.isTest && <Badge>Test</Badge>}
                      </span>
                    </td>
                    <td className="if-num">{d.durationMs !== null ? `${d.durationMs} ms` : '–'}</td>
                    <td className="if-num">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="rotate-cw"
                        disabled={d.pending}
                        pending={resending === d.id}
                        onClick={() => onResend(d.id)}>
                        Resend
                      </Button>
                    </td>
                  </tr>
                  {open === d.id && (
                    <tr className="if-log-detail">
                      <td />
                      <td colSpan={4}>
                        <span className="if-break">{d.url}</span>
                        {d.error && <span className="field-error">{d.error}</span>}
                        <pre className="if-code">{d.responseBody || '(empty response body)'}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

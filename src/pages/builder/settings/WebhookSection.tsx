import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Copy, KeyRound, Plus, RotateCw, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  BUILDER_API,
  type WebhookDeliveriesResponse,
  type WebhookInfo,
  type WebhookSecretResponse,
  type WebhookSendResult,
} from '@shared/api-builder'
import { webhookHeader } from '@shared/form/settings'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { Note, SwitchRow, TextRow } from '@/builder/controls'
import { useBuilder } from '@/builder/store'
import { useSettingsSave } from './hooks'
import { SettingsCard } from './shared'

type Header = { key: string; value: string }

const isHttpUrl = (v: string) => /^https?:\/\/[^\s/]+\.[^\s]+/i.test(v.trim()) && URL.canParse(v.trim())

/** Webhook (PRD "Webhook"): URL, headers, signing secret, test, delivery log with Resend. */
export function WebhookSection() {
  const formId = useBuilder((s) => s.meta.id)
  const webhook = useBuilder((s) => s.settings.webhook)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save, errors } = useSettingsSave()
  const queryClient = useQueryClient()
  const base = `${BUILDER_API}/forms/${formId}/webhook`
  const [url, setUrl] = useState(webhook.url ?? '')
  const [headers, setHeaders] = useState<Header[]>(webhook.headers)
  const [secret, setSecret] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)

  const [savedHeaders, setSavedHeaders] = useState(webhook.headers)
  if (savedHeaders !== webhook.headers) {
    setSavedHeaders(webhook.headers)
    setHeaders(webhook.headers)
  }

  const info = useQuery({ queryKey: ['webhook', formId, 'info'], queryFn: () => api<WebhookInfo>(base), enabled: !readOnly })
  const log = useQuery({ queryKey: ['webhook', formId, 'log'], queryFn: () => api<WebhookDeliveriesResponse>(`${base}/deliveries`), enabled: !readOnly })
  const refreshLog = () => queryClient.invalidateQueries({ queryKey: ['webhook', formId] })

  const rotate = useMutation({
    mutationFn: () => api<WebhookSecretResponse>(`${base}/secret`, { method: 'POST' }),
    onSuccess: (r) => {
      setSecret(r.secret)
      void refreshLog()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const test = useMutation({
    mutationFn: () => api<WebhookSendResult>(`${base}/test`, { method: 'POST' }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Test sent: the endpoint answered ${r.statusCode} in ${r.durationMs} ms`)
      else toast.error(`Test failed: ${r.error ?? `status ${r.statusCode}`}`)
      void refreshLog()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const resend = useMutation({
    mutationFn: (id: string) => api<WebhookSendResult>(`${base}/deliveries/${id}/resend`, { method: 'POST' }),
    onSuccess: (r) => {
      if (r.ok) toast.success('Delivery resent')
      else toast.error(`Resend failed: ${r.error ?? `status ${r.statusCode}`}`)
      void refreshLog()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const headerErrors = headers.map((h) => {
    if (!h.key && !h.value) return null
    const r = webhookHeader.safeParse(h)
    return r.success ? null : r.error.issues[0]?.message ?? 'Check this header'
  })

  function saveHeaders(next: Header[]) {
    const clean = next.filter((h) => h.key.trim())
    if (clean.every((h) => webhookHeader.safeParse(h).success)) void save({ webhook: { headers: clean.map((h) => ({ key: h.key.trim(), value: h.value })) } })
  }

  const urlValid = isHttpUrl(url)

  return (
    <SettingsCard
      id="webhook"
      title="Webhook"
      description="Sends each completed response as JSON to your URL, signed with HMAC-SHA256 (Standard Webhooks), so your server can check it came from here."
    >
      {readOnly ? (
        <p className="text-body-sm text-muted-foreground">{webhook.enabled && webhook.url ? `Responses are sent to ${webhook.url}.` : 'No webhook is set up.'}</p>
      ) : (
        <>
          <TextRow
            label="Endpoint URL"
            type="url"
            placeholder="https://example.com/hooks/intelform"
            value={url}
            error={errors['webhook.url'] ?? errors.webhook ?? (url && !urlValid ? 'Enter a full link starting with https://' : null)}
            onChange={(v) => {
              setUrl(v)
              if (!v.trim()) void save({ webhook: { url: null, enabled: false } })
              else if (isHttpUrl(v)) void save({ webhook: { url: v.trim() } })
            }}
          />
          <SwitchRow
            label="Send responses to this URL"
            description={urlValid ? 'One attempt per response. Failed deliveries can be resent from the log below.' : 'Add a URL first.'}
            checked={webhook.enabled}
            disabled={!webhook.url}
            onCheckedChange={(v) => void save({ webhook: { enabled: v } }, v ? 'Webhook on' : 'Webhook off')}
          />

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-label">Custom headers</legend>
            <p className="text-caption text-muted-foreground">For example an API key your endpoint expects. Up to 20.</p>
            {headers.map((h, i) => (
              <div key={i} className="grid gap-1">
                <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] gap-2">
                  <Input
                    aria-label={`Header ${i + 1} name`}
                    placeholder="Header name"
                    className="font-mono text-body-sm"
                    value={h.key}
                    aria-invalid={!!headerErrors[i] || undefined}
                    onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                    onBlur={() => saveHeaders(headers)}
                  />
                  <Input
                    aria-label={`Header ${i + 1} value`}
                    placeholder="Value"
                    className="font-mono text-body-sm"
                    value={h.value}
                    onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    onBlur={() => saveHeaders(headers)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove header ${h.key || i + 1}`}
                    onClick={() => {
                      const next = headers.filter((_, j) => j !== i)
                      setHeaders(next)
                      saveHeaders(next)
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                {headerErrors[i] && <p className="text-caption text-destructive">{headerErrors[i]}</p>}
              </div>
            ))}
            <Button variant="secondary" size="sm" className="w-fit" disabled={headers.length >= 20} onClick={() => setHeaders([...headers, { key: '', value: '' }])}>
              <Plus aria-hidden />
              Add header
            </Button>
          </fieldset>

          <div className="grid gap-2">
            <span className="text-label">Signing secret</span>
            {secret ? (
              <div className="grid gap-2">
                <Note tone="warning">Copy this secret now. For your security it won’t be shown again.</Note>
                <div className="flex gap-2">
                  <Input readOnly value={secret} aria-label="Signing secret" className="font-mono text-body-sm" onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(secret)
                        toast.success('Secret copied')
                      } catch {
                        toast.error('Couldn’t copy. Select the secret and copy it yourself.')
                      }
                    }}
                  >
                    <Copy aria-hidden />
                    Copy
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-caption text-muted-foreground">
                {info.data?.hasSecret
                  ? 'A secret is set. It is only shown when it is created; regenerate it if you lost it.'
                  : 'No secret yet. One is created with the first delivery, or generate it now to set up your endpoint.'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={rotate.isPending} onClick={() => (info.data?.hasSecret ? setConfirmRotate(true) : rotate.mutate())}>
                {rotate.isPending ? <Spinner /> : <KeyRound aria-hidden />}
                {info.data?.hasSecret ? 'Regenerate secret' : 'Generate secret'}
              </Button>
              <Button variant="secondary" size="sm" disabled={!webhook.url || test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? <Spinner /> : <Send aria-hidden />}
                Send test
              </Button>
            </div>
          </div>

          <DeliveryLog data={log.data} loading={log.isPending} onResend={(id) => resend.mutate(id)} resending={resend.isPending ? resend.variables : undefined} />
        </>
      )}

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the signing secret?</AlertDialogTitle>
            <AlertDialogDescription>
              Your endpoint will reject deliveries until you give it the new secret. The old one stops working right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the current secret</AlertDialogCancel>
            <AlertDialogAction onClick={() => rotate.mutate()}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}

function DeliveryLog({
  data,
  loading,
  onResend,
  resending,
}: {
  data: WebhookDeliveriesResponse | undefined
  loading: boolean
  onResend(id: string): void
  resending?: string
}) {
  const [open, setOpen] = useState<string | null>(null)
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label">Delivery log</span>
        <span className="text-caption text-muted-foreground">The last 100 attempts</span>
      </div>
      {loading ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : !data?.deliveries.length ? (
        <p className="rounded-md border border-dashed border-input px-4 py-6 text-center text-body-sm text-muted-foreground">No deliveries yet. Send a test to check your endpoint.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Details</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Duration
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.deliveries.map((d) => (
                <Fragment key={d.id}>
                  <tr className="border-t border-border">
                    <td className="w-8 px-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-expanded={open === d.id}
                        aria-label={open === d.id ? 'Hide response body' : 'Show response body'}
                        onClick={() => setOpen(open === d.id ? null : d.id)}
                      >
                        <ChevronRight aria-hidden className={cn('transition-transform duration-(--duration-base) ease-out', open === d.id && 'rotate-90')} />
                      </Button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmt.format(new Date(d.createdAt))}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant={d.ok ? 'success' : 'danger'}>{d.statusCode ?? 'No answer'}</Badge>
                        {d.isTest && <Badge variant="muted">Test</Badge>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.durationMs !== null ? `${d.durationMs} ms` : '–'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="xs" disabled={resending === d.id} onClick={() => onResend(d.id)}>
                        {resending === d.id ? <Spinner /> : <RotateCw aria-hidden />}
                        Resend
                      </Button>
                    </td>
                  </tr>
                  {open === d.id && (
                    <tr className="animate-fade-in bg-muted/40">
                      <td />
                      <td colSpan={4} className="px-3 py-2">
                        <div className="grid gap-1.5">
                          <span className="text-caption break-all text-muted-foreground">{d.url}</span>
                          {d.error && <span className="text-caption text-destructive">{d.error}</span>}
                          <pre className="max-h-40 overflow-auto rounded-sm bg-card p-2 font-mono text-caption whitespace-pre-wrap">{d.responseBody || '(empty response body)'}</pre>
                        </div>
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
  )
}

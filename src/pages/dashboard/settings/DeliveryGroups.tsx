import { Info, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  EMAIL_DRIVER_LABEL,
  emailSettingsInput,
  spamSettingsInput,
  type AppSettingsView,
  type EmailDriverName,
} from '@shared/settings-app'
import { Field } from '@/components/common/Field'
import { Collapsible, CollapsibleChevron, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMe } from '@/lib/auth'
import { GroupCard, SecretField, SwitchRow, TestResult } from '@/pages/dashboard/settings/bits'
import { apiErrors, zodErrors, type Errors } from '@/pages/dashboard/settings/form-utils'
import { useSaveSettings, useSettingsTest } from '@/pages/dashboard/settings/queries'

type Secret = string | null | undefined

/** Only the keys whose secret changed are sent; undefined keeps the stored value. */
function secretPatch<K extends string>(entries: Record<K, Secret>): Partial<Record<K, string | null>> {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined)) as Partial<Record<K, string | null>>
}

// ---------------------------------------------------------------------------
// Spam protection
// ---------------------------------------------------------------------------

export function SpamGroup({ view }: { view: AppSettingsView }) {
  const [siteKey, setSiteKey] = useState(view.spam.turnstileSiteKey ?? '')
  const [secret, setSecret] = useState<Secret>(undefined)
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()
  const test = useSettingsTest('spam')
  const dirty = siteKey.trim() !== (view.spam.turnstileSiteKey ?? '') || secret !== undefined

  function submit() {
    const input = { turnstileSiteKey: siteKey.trim() || null, ...secretPatch({ turnstileSecret: secret }) }
    const r = zodErrors(spamSettingsInput, input)
    if (r.errors) return setErrors({ siteKey: r.errors.turnstileSiteKey, secret: r.errors.turnstileSecret, _form: r.errors._form })
    setErrors({})
    test.reset()
    save.mutate(
      { spam: r.data },
      {
        onSuccess: (next) => {
          setSiteKey(next.spam.turnstileSiteKey ?? '')
          setSecret(undefined)
          toast.success('Spam protection saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  const configured = !!view.spam.turnstileSiteKey && view.spam.turnstileSecret.set
  return (
    <GroupCard
      title="Spam protection"
      description="Optional. Cloudflare Turnstile checks that a person, not a bot, submits your forms. Each form can turn it off in its settings."
      onSubmit={submit}
      dirty={dirty}
      saving={save.isPending}
      formError={errors._form ?? errors.spam}
      footer={
        <Button type="button" variant="outline" disabled={dirty || !configured || test.isPending} onClick={() => test.mutate({})}>
          <ShieldCheck aria-hidden />
          {test.isPending ? 'Testing…' : 'Test keys'}
        </Button>
      }
    >
      <p className="text-body-sm text-muted-foreground">
        Without keys, forms are still protected by a honeypot and a rate limit. Add Turnstile if a form starts getting spam: create a widget in the Cloudflare dashboard under Turnstile, add this site’s domain, then paste both keys here.
      </p>
      <Field label="Site key" description="Public. Starts with 0x." error={errors.siteKey}>
        {(p) => <Input {...p} value={siteKey} spellCheck={false} autoComplete="off" onChange={(e) => setSiteKey(e.target.value)} className="font-mono sm:max-w-sm" />}
      </Field>
      <SecretField label="Secret key" description="Stored encrypted and never shown again." state={view.spam.turnstileSecret} value={secret} onChange={setSecret} error={errors.secret} />
      {!configured && !dirty && <p className="text-caption text-muted-foreground">Add both keys and save to test them.</p>}
      <TestResult result={test.data ?? (test.error ? { ok: false, message: test.error.message } : null)} />
    </GroupCard>
  )
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const DRIVER_HELP: Partial<Record<EmailDriverName, string>> = {
  none: 'No emails are sent. Invites are shared as links, and “Forgot password” is hidden.',
  console: 'Emails are printed in the server log. For development only.',
  smtp: 'Works with most providers, including Amazon SES, Mailgun and Brevo.',
  resend: 'Uses the Resend API.',
  postmark: 'Uses the Postmark API with a server token.',
}

const DNS_CHECKLIST = [
  'Verify your sending domain with the provider.',
  'Add the DKIM records the provider gives you.',
  'Keep one SPF record, with the provider’s include: added to it.',
  'Add a DMARC record, starting with p=none.',
  'Send from a subdomain such as mail.example.com.',
  'Use a From address on the verified domain. Replies go to the Reply-to address.',
]

export function EmailGroup({ view }: { view: AppSettingsView }) {
  const me = useMe()
  const initial = view.email
  const plain = {
    driver: initial.driver,
    fromName: initial.fromName ?? '',
    fromAddress: initial.fromAddress ?? '',
    replyTo: initial.replyTo ?? '',
    smtpHost: initial.smtpHost ?? '',
    smtpPort: initial.smtpPort === null ? '' : String(initial.smtpPort),
    smtpSecure: initial.smtpSecure,
    smtpUser: initial.smtpUser ?? '',
  }
  const [v, setV] = useState(plain)
  const [secrets, setSecrets] = useState<{ smtpPass: Secret; resendApiKey: Secret; postmarkToken: Secret }>({
    smtpPass: undefined,
    resendApiKey: undefined,
    postmarkToken: undefined,
  })
  const [to, setTo] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()
  const test = useSettingsTest('email')
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }))
  const dirty = JSON.stringify(v) !== JSON.stringify(plain) || Object.values(secrets).some((s) => s !== undefined)
  const drivers = (['none', 'smtp', 'resend', 'postmark'] as EmailDriverName[]).concat(initial.driver === 'console' ? ['console'] : [])
  const sending = v.driver !== 'none' && v.driver !== 'console'

  function submit() {
    const nul = (s: string) => (s.trim() ? s.trim() : null)
    const input = {
      driver: v.driver,
      fromName: nul(v.fromName),
      fromAddress: nul(v.fromAddress),
      replyTo: nul(v.replyTo),
      smtpHost: nul(v.smtpHost),
      smtpPort: v.smtpPort.trim() ? v.smtpPort.trim() : null,
      smtpSecure: v.smtpSecure,
      smtpUser: nul(v.smtpUser),
      ...secretPatch(secrets),
    }
    const r = zodErrors(emailSettingsInput, input)
    if (r.errors) return setErrors(r.errors)
    if (sending && !input.fromAddress) return setErrors({ fromAddress: 'Enter the address emails come from, like forms@mail.example.com' })
    if (v.driver === 'smtp' && !input.smtpHost) return setErrors({ smtpHost: 'Enter the SMTP host, like smtp.example.com' })
    setErrors({})
    test.reset()
    save.mutate(
      { email: r.data },
      {
        onSuccess: (next) => {
          const e = next.email
          setV({
            driver: e.driver,
            fromName: e.fromName ?? '',
            fromAddress: e.fromAddress ?? '',
            replyTo: e.replyTo ?? '',
            smtpHost: e.smtpHost ?? '',
            smtpPort: e.smtpPort === null ? '' : String(e.smtpPort),
            smtpSecure: e.smtpSecure,
            smtpUser: e.smtpUser ?? '',
          })
          setSecrets({ smtpPass: undefined, resendApiKey: undefined, postmarkToken: undefined })
          toast.success('Email settings saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  return (
    <GroupCard
      title="Email"
      description="Sends invites, password resets, response notifications and confirmation emails."
      onSubmit={submit}
      dirty={dirty}
      saving={save.isPending}
      formError={errors._form ?? errors.email}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label">Status</span>
        <Badge variant={initial.enabled ? 'success' : 'muted'}>{initial.enabled ? 'Sending' : 'Off'}</Badge>
      </div>
      {initial.envOverride && (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>The server overrides these settings</AlertTitle>
          <AlertDescription className="text-info-subtle-foreground">
            EMAIL_DRIVER={initial.envOverride} is set in the server environment, so emails are {initial.envOverride === 'console' ? 'printed in the server log' : 'not sent'}. Remove it to use the provider below.
          </AlertDescription>
        </Alert>
      )}
      <Field label="Provider" description={DRIVER_HELP[v.driver]} error={errors.driver}>
        {(p) => (
          <Select value={v.driver} onValueChange={(d) => set('driver', d as EmailDriverName)}>
            <SelectTrigger {...p} className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d} value={d}>
                  {EMAIL_DRIVER_LABEL[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {v.driver === 'smtp' && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label="SMTP host" error={errors.smtpHost} required>
            {(p) => <Input {...p} value={v.smtpHost} placeholder="smtp.example.com" spellCheck={false} onChange={(e) => set('smtpHost', e.target.value)} />}
          </Field>
          <Field label="Port" error={errors.smtpPort}>
            {(p) => <Input {...p} inputMode="numeric" value={v.smtpPort} placeholder="587" onChange={(e) => set('smtpPort', e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <div className="sm:col-span-2">
            <SwitchRow
              label="Use TLS from the start"
              description="On for port 465. Off for 587, which upgrades with STARTTLS."
              checked={v.smtpSecure}
              onCheckedChange={(c) => set('smtpSecure', c)}
            />
          </div>
          <Field label="Username" error={errors.smtpUser}>
            {(p) => <Input {...p} value={v.smtpUser} autoComplete="off" spellCheck={false} onChange={(e) => set('smtpUser', e.target.value)} />}
          </Field>
          <div className="sm:col-span-2">
            <SecretField label="Password" state={initial.smtpPass} value={secrets.smtpPass} onChange={(s) => setSecrets((p) => ({ ...p, smtpPass: s }))} error={errors.smtpPass} autoComplete="new-password" />
          </div>
        </div>
      )}
      {v.driver === 'resend' && (
        <SecretField label="Resend API key" description="Starts with re_. Needs sending access." state={initial.resendApiKey} value={secrets.resendApiKey} onChange={(s) => setSecrets((p) => ({ ...p, resendApiKey: s }))} error={errors.resendApiKey} />
      )}
      {v.driver === 'postmark' && (
        <SecretField label="Postmark server token" state={initial.postmarkToken} value={secrets.postmarkToken} onChange={(s) => setSecrets((p) => ({ ...p, postmarkToken: s }))} error={errors.postmarkToken} />
      )}

      {v.driver !== 'none' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sender name" description="Shown as who the email is from." error={errors.fromName}>
            {(p) => <Input {...p} value={v.fromName} onChange={(e) => set('fromName', e.target.value)} />}
          </Field>
          <Field label="Sender address" description="Must be on your verified domain." error={errors.fromAddress} required={sending}>
            {(p) => <Input {...p} type="email" value={v.fromAddress} placeholder="forms@mail.example.com" onChange={(e) => set('fromAddress', e.target.value)} />}
          </Field>
          <Field label="Reply-to address" description="Optional. Where replies go." error={errors.replyTo}>
            {(p) => <Input {...p} type="email" value={v.replyTo} onChange={(e) => set('replyTo', e.target.value)} />}
          </Field>
        </div>
      )}

      {sending && (
        <Collapsible className="rounded-lg border border-border bg-muted px-4 py-3 text-body-sm">
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-sm text-left text-label">
            <CollapsibleChevron />
            DNS checklist for reliable delivery
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-3 grid list-decimal gap-1.5 pl-11 text-muted-foreground">
              {DNS_CHECKLIST.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="grid gap-3 border-t border-border pt-5">
        <span className="text-label">Send a test email</span>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            type="email"
            aria-label="Send the test to"
            value={to}
            placeholder={me.email}
            onChange={(e) => setTo(e.target.value)}
            className="sm:max-w-xs"
          />
          <Button type="button" variant="outline" disabled={dirty || test.isPending || !initial.enabled} onClick={() => test.mutate(to.trim() ? { to: to.trim() } : {})}>
            <Send aria-hidden />
            {test.isPending ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">
          {dirty ? 'Save your changes first.' : !initial.enabled ? 'Choose a provider and save to send a test.' : `Leave empty to send it to ${me.email}.`}
        </p>
        <TestResult result={test.data ?? (test.error ? { ok: false, message: test.error.message } : null)} />
      </div>
    </GroupCard>
  )
}

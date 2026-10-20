import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import type { TeamResponse } from '@shared/api'
import { formSettingsPatch } from '@shared/form/settings'
import { isSafeUrl } from '@shared/form/safe-url'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/components/ui/cn'
import { api, errorMessage } from '@/lib/api'
import { FieldRow, Note, NumberRow, SelectRow, SwitchRow, TextRow } from '@/builder/controls'
import { useDraftText } from '@/builder/use-draft-text'
import { fieldName } from '@/builder/ops'
import { PipeInput } from '@/builder/pipe/PipeInput'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { browserTimeZone, isoToZoned, timeZones, zonedToIso } from '@/builder/tz'
import { LabelsEditor } from './LabelsEditor'
import { refreshFromServer, useCapabilities, useSettingsSave } from './hooks'
import { SettingsCard } from './shared'
import { WebhookSection } from './WebhookSection'

const NAV = [
  { id: 'access', label: 'Access and limits' },
  { id: 'after-submit', label: 'After submit' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'webhook', label: 'Webhook' },
  { id: 'spam', label: 'Spam protection' },
  { id: 'language', label: 'Language' },
  { id: 'labels', label: 'System labels' },
  { id: 'consent', label: 'Consent records' },
]

/** Settings tab: every group of PRD "Form settings". Safe defaults; changes save on their own. */
export function SettingsTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl grid-cols-[180px_minmax(0,1fr)] gap-8 px-6 py-8">
        <nav aria-label="Settings sections" className="sticky top-0 self-start">
          <ul className="grid gap-0.5">
            {NAV.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} className="focus-ring block rounded-md px-3 py-1.5 text-body-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-6">
          <AccessSection />
          <AfterSubmitSection />
          <NotificationsSection />
          <WebhookSection />
          <SpamSection />
          <LanguageSection />
          <LabelsEditor />
          <SettingsCard id="consent" title="Consent records">
            <p className="text-body-sm text-muted-foreground">
              When a Consent question is answered, the response stores that the box was ticked, the time, the exact checkbox text shown and the form version. Nothing to set
              up: add a Consent / Terms question on the Build tab.
            </p>
          </SettingsCard>
        </div>
      </div>
    </div>
  )
}

function useEmailFields() {
  const draft = useBuilder((s) => s.doc.draft)
  return useMemo(() => draft.fields.filter((f) => f.type === 'email').map((f) => ({ value: f.id, label: fieldName(draft, f) })), [draft])
}

// ---------------------------------------------------------------------------
// Access and limits
// ---------------------------------------------------------------------------

function AccessSection() {
  const store = useBuilderStore()
  const settings = useBuilder((s) => s.settings)
  const status = useBuilder((s) => s.meta.status)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save, errors } = useSettingsSave()
  const emailFields = useEmailFields()
  const [closing, setClosing] = useState(false)
  const closedMessage = useDraftText(settings.closedMessage, (v) => void save({ closedMessage: v }))
  const zones = useMemo(() => timeZones(), [])
  const tz = settings.timezone === 'UTC' && !settings.closeAt ? browserTimeZone() : settings.timezone
  const [capOn, setCapOn] = useState(settings.responseCap !== null)

  async function toggleClosed(v: boolean) {
    setClosing(true)
    try {
      await store.getState().flush()
      await api(`/api/forms/${store.getState().meta.id}/${v ? 'close' : 'reopen'}`, { method: 'POST' })
      await refreshFromServer(store)
      toast.success(v ? 'Form closed' : 'Form reopened')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setClosing(false)
    }
  }

  const defaultClose = () => {
    const d = new Date(Date.now() + 7 * 864e5)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T17:00`
  }

  return (
    <SettingsCard id="access" title="Access and limits" description="Who can respond, and when the form stops taking responses.">
      <SwitchRow
        label="Close the form now"
        description={status === 'draft' ? 'Publish the form first; a draft is not open to anyone yet.' : 'Visitors see the closed message instead of the form.'}
        checked={status === 'closed'}
        disabled={readOnly || status === 'draft' || closing}
        onCheckedChange={toggleClosed}
      />
      <div className="grid gap-3">
        <SwitchRow
          label="Close on a date"
          checked={settings.closeAt !== null}
          disabled={readOnly}
          onCheckedChange={(v) => void save(v ? { closeAt: zonedToIso(defaultClose(), tz), timezone: tz } : { closeAt: null })}
        />
        {settings.closeAt && (
          <div className="grid grid-cols-2 gap-3 pl-0">
            <TextRow
              label="Date and time"
              type="datetime-local"
              value={isoToZoned(settings.closeAt, tz)}
              disabled={readOnly}
              error={errors.closeAt}
              onChange={(v) => {
                const iso = zonedToIso(v, tz)
                if (iso) void save({ closeAt: iso, timezone: tz })
              }}
            />
            <SelectRow
              label="Time zone"
              value={tz}
              options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
              disabled={readOnly}
              onChange={(z) => void save({ timezone: z, closeAt: zonedToIso(isoToZoned(settings.closeAt!, tz), z) })}
            />
          </div>
        )}
      </div>
      <div className="grid gap-3">
        <SwitchRow
          label="Limit the number of responses"
          description="Closes the form after this many completed responses."
          checked={capOn}
          disabled={readOnly}
          onCheckedChange={(v) => {
            setCapOn(v)
            void save({ responseCap: v ? 100 : null })
          }}
        />
        {capOn && (
          <NumberRow
            label="Maximum responses"
            value={settings.responseCap}
            min={1}
            max={10_000_000}
            placeholder="100"
            disabled={readOnly}
            onChange={(v) => v !== null && void save({ responseCap: v })}
          />
        )}
      </div>
      <TextRow label="Closed message" multiline maxLength={1000} disabled={readOnly} error={errors.closedMessage} {...closedMessage} />
      <SwitchRow
        label="One response per browser"
        description="A soft limit: stops repeat answers from the same browser, not a determined person."
        checked={settings.onePerBrowser}
        disabled={readOnly}
        onCheckedChange={(v) => void save({ onePerBrowser: v })}
      />
      <div className="grid gap-3">
        <SwitchRow
          label="One response per email address"
          description="Refuses a second response with the same email."
          checked={settings.onePerEmail}
          disabled={readOnly || (!emailFields.length && !settings.onePerEmail)}
          onCheckedChange={(v) => void save({ onePerEmail: v, onePerEmailFieldId: v ? (settings.onePerEmailFieldId ?? emailFields[0]?.value ?? null) : settings.onePerEmailFieldId })}
        />
        {!emailFields.length && <p className="text-caption text-muted-foreground">Add an Email question to use this.</p>}
        {settings.onePerEmail && emailFields.length > 0 && (
          <SelectRow label="Email question to check" value={settings.onePerEmailFieldId} options={emailFields} disabled={readOnly} onChange={(v) => void save({ onePerEmailFieldId: v })} />
        )}
      </div>
      <PasswordSetting />
    </SettingsCard>
  )
}

function PasswordSetting() {
  const hasPassword = useBuilder((s) => s.settings.hasPassword)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save } = useSettingsSave()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const parsed = formSettingsPatch.shape.password.safeParse(value)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Use at least 4 characters')
    setBusy(true)
    const ok = await save({ password: value }, 'Password set')
    setBusy(false)
    if (ok) {
      setEditing(false)
      setValue('')
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-label">Password protection</span>
          <span className="text-caption text-muted-foreground">
            {hasPassword ? 'Respondents enter the password before the form opens. It is stored hashed and can’t be shown.' : 'Off. Anyone with the link can respond.'}
          </span>
        </div>
        {!readOnly && !editing && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <KeyRound aria-hidden />
              {hasPassword ? 'Change' : 'Set password'}
            </Button>
            {hasPassword && (
              <Button size="sm" variant="ghost" onClick={() => void save({ password: null }, 'Password removed')}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <FieldRow label="New password" error={error} className="flex-1">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={value}
                autoFocus
                onChange={(e) => (setValue(e.target.value), setError(null))}
              />
            )}
          </FieldRow>
          <Button type="submit" className="mt-6.5" disabled={busy}>
            {busy && <Spinner />}
            Save password
          </Button>
          <Button type="button" variant="ghost" className="mt-6.5" onClick={() => (setEditing(false), setValue(''), setError(null))}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// After submit
// ---------------------------------------------------------------------------

function AfterSubmitSection() {
  const settings = useBuilder((s) => s.settings)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save, errors } = useSettingsSave()
  const [url, setUrl] = useState(settings.redirectUrl ?? '')
  const valid = /^https?:\/\//i.test(url.trim()) && isSafeUrl(url.trim())

  return (
    <SettingsCard id="after-submit" title="After submit">
      <RadioGroup
        aria-label="After submit"
        value={settings.afterSubmit}
        onValueChange={(v) => {
          if (v === 'end_screen') void save({ afterSubmit: 'end_screen' })
          else if (valid) void save({ afterSubmit: 'redirect', redirectUrl: url.trim() })
          else document.getElementById('redirect-url')?.focus()
        }}
        disabled={readOnly}
        className="grid gap-2"
      >
        {(
          [
            ['end_screen', 'Show the end screen', 'The thank-you screen from the Build tab.'],
            ['redirect', 'Send people to a web page', 'Skip the end screen and open a link instead.'],
          ] as const
        ).map(([value, title, help]) => (
          <Label
            key={value}
            htmlFor={`after-${value}`}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 font-normal',
              settings.afterSubmit === value && 'border-option-selected-border bg-option-selected',
            )}
          >
            <RadioGroupItem id={`after-${value}`} value={value} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-label">{title}</span>
              <span className="text-caption text-muted-foreground">{help}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <TextRow
        id="redirect-url"
        label="Redirect link"
        type="url"
        placeholder="https://example.com/thanks"
        value={url}
        disabled={readOnly}
        description={settings.afterSubmit === 'redirect' ? undefined : 'Enter a link, then choose “Send people to a web page”.'}
        error={errors.redirectUrl ?? (url && !valid ? 'Enter a full link starting with https://' : null)}
        onChange={(v) => {
          setUrl(v)
          const t = v.trim()
          if (/^https?:\/\//i.test(t) && isSafeUrl(t)) void save({ redirectUrl: t })
        }}
      />
      <SwitchRow
        label="Add the answers to the link"
        description="Appends answers as URL parameters, e.g. ?email=…, for a thank-you page that greets people."
        checked={settings.redirectAppendAnswers}
        disabled={readOnly || settings.afterSubmit !== 'redirect'}
        onCheckedChange={(v) => void save({ redirectAppendAnswers: v })}
      />
    </SettingsCard>
  )
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function NotificationsSection() {
  const settings = useBuilder((s) => s.settings)
  const readOnly = useBuilder((s) => s.readOnly)
  const fieldCount = useBuilder((s) => s.doc.draft.fields.length)
  const { save, errors } = useSettingsSave()
  const caps = useCapabilities()
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<TeamResponse>('/api/team'), staleTime: 60_000 })
  const emailFields = useEmailFields()
  const subject = useDraftText(settings.confirmationSubject, (v) => void save({ confirmationSubject: v }))
  const body = useDraftText(settings.confirmationBody, (v) => void save({ confirmationBody: v }), 900)
  const emailOff = caps.data ? !caps.data.emailEnabled : false
  const members = team.data?.members ?? []
  const owner = members.find((m) => m.role === 'owner')
  const selected = new Set(settings.notifyRecipients)

  return (
    <SettingsCard id="notifications" title="Notifications" description="Emails sent when someone responds.">
      {emailOff && (
        <Note tone="warning">
          Email isn’t set up on this site yet, so these emails won’t be sent. The Owner can add an email provider in Settings, under Email. Your choices here are kept.
        </Note>
      )}
      <div className="grid gap-3">
        <SwitchRow
          label="Email me on each response"
          description="Includes every answer and a link to the response."
          checked={settings.notifyOnResponse}
          disabled={readOnly}
          onCheckedChange={(v) => void save({ notifyOnResponse: v })}
        />
        {settings.notifyOnResponse && (
          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-label">Who gets it</legend>
            <p className="text-caption text-muted-foreground">With nobody ticked, it goes to the Owner{owner ? ` (${owner.name})` : ''}.</p>
            {team.isPending && <p className="text-caption text-muted-foreground">Loading the team…</p>}
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2.5 text-body-sm">
                <Checkbox
                  checked={selected.has(m.id)}
                  disabled={readOnly}
                  onCheckedChange={(c) => void save({ notifyRecipients: c ? [...settings.notifyRecipients, m.id] : settings.notifyRecipients.filter((x) => x !== m.id) })}
                />
                <span>{m.name}</span>
                <span className="text-muted-foreground">{m.email}</span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <div className="grid gap-3">
        <SwitchRow
          label="Send a confirmation to the respondent"
          description={emailFields.length ? 'Goes to the address they enter in an Email question.' : 'Add an Email question to use this.'}
          checked={settings.confirmationEmail}
          disabled={readOnly || (!emailFields.length && !settings.confirmationEmail)}
          onCheckedChange={(v) => void save({ confirmationEmail: v, ...(v && !settings.confirmationEmailFieldId ? { confirmationEmailFieldId: emailFields[0]?.value ?? null } : {}) })}
        />
        {settings.confirmationEmail && (
          <>
            <SelectRow label="Send to the address in" value={settings.confirmationEmailFieldId} options={emailFields} disabled={readOnly} onChange={(v) => void save({ confirmationEmailFieldId: v })} />
            <TextRow label="Subject" maxLength={200} disabled={readOnly} error={errors.confirmationSubject} {...subject} />
            <div className="grid gap-1.5">
              <Label className="text-label">Message</Label>
              <PipeInput ariaLabel="Confirmation message" multiline value={body.value} onChange={body.onChange} beforeIndex={fieldCount} readOnly={readOnly} />
              <p className="text-caption text-muted-foreground">Type @ to include an answer, e.g. their name.</p>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  )
}

// ---------------------------------------------------------------------------
// Spam
// ---------------------------------------------------------------------------

function SpamSection() {
  const turnstile = useBuilder((s) => s.settings.turnstile)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save } = useSettingsSave()
  const caps = useCapabilities()
  return (
    <SettingsCard id="spam" title="Spam protection" description="A hidden honeypot field and a limit of 10 submissions a minute per visitor are always on.">
      <SwitchRow
        label="Cloudflare Turnstile"
        description="An invisible check that stops bots. Most people never see a challenge."
        checked={turnstile}
        disabled={readOnly}
        onCheckedChange={(v) => void save({ turnstile: v })}
      />
      {caps.data && !caps.data.turnstileConfigured && (
        <Note tone={turnstile ? 'warning' : 'info'}>
          {turnstile
            ? 'Turnstile is on, but its keys aren’t set on this site, so bots are not being checked. The Owner adds the keys once in Settings, under Spam protection.'
            : 'Turnstile keys aren’t set on this site. The Owner adds them once in Settings, under Spam protection.'}
        </Note>
      )}
    </SettingsCard>
  )
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

const COMMON_LANGUAGES = ['en', 'en-GB', 'de', 'fr', 'es', 'it', 'pt', 'pt-BR', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'tr', 'ar', 'he', 'hi', 'bn', 'ja', 'ko', 'zh-Hans', 'zh-Hant']

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

function LanguageSection() {
  const language = useBuilder((s) => s.settings.language)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save, errors } = useSettingsSave()
  const [text, setText] = useState(language)
  const options = COMMON_LANGUAGES.includes(language) ? COMMON_LANGUAGES : [language, ...COMMON_LANGUAGES]
  return (
    <SettingsCard id="language" title="Language" description="The language the form is written in. Screen readers use it to pronounce the questions correctly.">
      <div className="grid grid-cols-2 gap-4">
        <SelectRow
          label="Form language"
          value={language}
          options={options.map((l) => ({ value: l, label: `${languageName(l)} (${l})` }))}
          disabled={readOnly}
          onChange={(v) => {
            setText(v)
            void save({ language: v })
          }}
        />
        <TextRow
          label="Or a language code"
          description="Any BCP-47 code, e.g. sw or fr-CA."
          value={text}
          maxLength={35}
          disabled={readOnly}
          error={errors.language}
          onChange={setText}
          onBlur={() => {
            if (text.trim() && text.trim() !== language) void save({ language: text.trim() })
          }}
        />
      </div>
      <p className="text-caption text-muted-foreground">Translate the buttons and messages below in System labels.</p>
    </SettingsCard>
  )
}

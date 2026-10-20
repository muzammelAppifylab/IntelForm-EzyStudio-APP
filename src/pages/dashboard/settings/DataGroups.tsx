import { Download, HardDriveUpload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { dataSettingsInput, type AppSettingsView } from '@shared/settings-app'
import { Field } from '@/components/common/Field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GroupCard, SwitchRow, TestResult } from '@/pages/dashboard/settings/bits'
import { apiErrors, zodErrors, type Errors } from '@/pages/dashboard/settings/form-utils'
import { useSaveSettings, useSettingsTest } from '@/pages/dashboard/settings/queries'

export function StorageGroup({ view }: { view: AppSettingsView }) {
  const test = useSettingsTest('storage')
  const { storage } = view
  const bunny = storage.driver === 'bunny'
  return (
    <GroupCard
      title="Storage"
      description="Where uploaded images live: logos, favicons, form images and avatars. It is set up on the server, not here."
      footer={
        <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate({})}>
          <HardDriveUpload aria-hidden />
          {test.isPending ? 'Testing…' : 'Test upload'}
        </Button>
      }
    >
      <dl className="grid gap-3 text-body-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-label">Status</dt>
        <dd>
          <Badge variant={bunny ? 'success' : 'warning'}>{bunny ? 'Bunny storage' : 'Local disk'}</Badge>
        </dd>
        {bunny && (
          <>
            <dt className="text-label">Storage zone</dt>
            <dd className="font-mono">{storage.zone}</dd>
          </>
        )}
        <dt className="text-label">Files served from</dt>
        <dd className="font-mono break-all">{storage.publicBaseUrl}</dd>
      </dl>
      {!bunny && (
        <p className="text-body-sm text-muted-foreground">
          Images are saved on this server’s disk. Set BUNNY_STORAGE_ZONE, BUNNY_STORAGE_KEY and BUNNY_CDN_URL to serve them from the Bunny CDN.
        </p>
      )}
      <TestResult result={test.data ?? (test.error ? { ok: false, message: test.error.message } : null)} />
    </GroupCard>
  )
}

export function DataGroup({ view }: { view: AppSettingsView }) {
  const initialDays = view.data.retentionDays
  const [on, setOn] = useState(initialDays !== null)
  const [days, setDays] = useState(initialDays === null ? '365' : String(initialDays))
  const [errors, setErrors] = useState<Errors>({})
  const save = useSaveSettings()
  const value = on ? days : null
  const dirty = (value === null ? null : Number(value)) !== initialDays

  function submit() {
    const r = zodErrors(dataSettingsInput, { retentionDays: value === null ? null : value.trim() || undefined })
    if (r.errors) return setErrors(r.errors)
    if (on && !days.trim()) return setErrors({ retentionDays: 'Enter a number of days' })
    setErrors({})
    save.mutate(
      { data: r.data },
      {
        onSuccess: (next) => {
          setOn(next.data.retentionDays !== null)
          if (next.data.retentionDays !== null) setDays(String(next.data.retentionDays))
          toast.success(next.data.retentionDays === null ? 'Responses are kept' : 'Retention saved')
        },
        onError: (err) => setErrors(apiErrors(err)),
      },
    )
  }

  return (
    <GroupCard
      title="Data"
      description="How long responses are kept, and a copy of all of them."
      onSubmit={submit}
      dirty={dirty}
      saving={save.isPending}
      formError={errors._form ?? errors.data}
    >
      <SwitchRow
        label="Delete old responses"
        description="Off by default: responses are kept until you delete them. When on, a daily job removes responses older than the limit."
        checked={on}
        onCheckedChange={setOn}
      />
      {on && (
        <Field label="Delete responses older than" description="In days, from 1 to 3650." error={errors.retentionDays}>
          {(p) => (
            <div className="flex items-center gap-2">
              <Input {...p} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} className="w-28" />
              <span className="text-body-sm text-muted-foreground">days</span>
            </div>
          )}
        </Field>
      )}
      <div className="grid justify-items-start gap-2 border-t border-border pt-5">
        <span className="text-label">Export</span>
        <p className="text-body-sm text-muted-foreground">One CSV per form, in a ZIP file. Large exports can take a minute to start.</p>
        <Button asChild variant="outline">
          <a href="/api/settings/data/export.zip" download>
            <Download aria-hidden />
            Export all responses (ZIP)
          </a>
        </Button>
      </div>
    </GroupCard>
  )
}

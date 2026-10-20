import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { LABEL_KEYS, SYSTEM_LABELS, type LabelKey } from '@shared/form/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBuilder } from '@/builder/store'
import { useSettingsSave } from './hooks'
import { SettingsCard } from './shared'

/** Readable names for the label keys, e.g. "pressEnter" → "Press enter". */
function keyName(k: string): string {
  const words = k.replace(/([A-Z])/g, ' $1').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** System labels (PRD "Spam and text"): Start, Next, Submit, errors… per form, for other languages. */
export function LabelsEditor() {
  const saved = useBuilder((s) => s.settings.labels)
  const readOnly = useBuilder((s) => s.readOnly)
  const { save } = useSettingsSave()
  const [draft, setDraft] = useState<Record<string, string>>(saved)
  const [query, setQuery] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Record<string, string> | null>(null)

  useEffect(() => {
    if (!pending.current) setDraft(saved)
  }, [saved])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) void save({ labels: pending.current })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function change(key: LabelKey, value: string) {
    const next = { ...draft }
    if (value.trim() && value !== SYSTEM_LABELS[key]) next[key] = value.slice(0, 300)
    else delete next[key]
    setDraft(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const body = pending.current
      pending.current = null
      if (body) void save({ labels: body })
    }, 800)
  }

  const keys = useMemo(() => {
    const q = query.trim().toLowerCase()
    return LABEL_KEYS.filter((k) => !q || `${keyName(k)} ${SYSTEM_LABELS[k]} ${draft[k] ?? ''}`.toLowerCase().includes(q))
  }, [query, draft])
  const changed = Object.keys(draft).length

  return (
    <SettingsCard
      id="labels"
      title="System labels"
      description="The fixed text respondents see: buttons, hints and error messages. Change them to match your form’s language. Empty means the default."
    >
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search labels" placeholder="Search labels" className="pl-9 text-body" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="text-caption text-muted-foreground">{changed ? `${changed} changed` : 'All defaults'}</span>
        {changed > 0 && !readOnly && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft({})
              pending.current = null
              void save({ labels: {} }, 'Labels reset')
            }}
          >
            <RotateCcw aria-hidden />
            Reset all
          </Button>
        )}
      </div>
      <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border">
        <table className="w-full text-body-sm">
          <thead className="sticky top-0 bg-muted text-left">
            <tr>
              <th scope="col" className="w-48 px-3 py-2 text-label font-medium">
                Label
              </th>
              <th scope="col" className="px-3 py-2 text-label font-medium">
                Text shown
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="px-3 py-1.5 text-left align-middle font-normal text-muted-foreground">
                  <label htmlFor={`label-${k}`}>{keyName(k)}</label>
                </th>
                <td className="px-3 py-1.5">
                  <Input
                    id={`label-${k}`}
                    className="h-(--control-sm) text-body-sm"
                    value={draft[k] ?? ''}
                    placeholder={SYSTEM_LABELS[k]}
                    maxLength={300}
                    readOnly={readOnly}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </td>
              </tr>
            ))}
            {!keys.length && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                  No label matches “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-muted-foreground">{'Keep placeholders like {n} and {total}: they are replaced with numbers, e.g. “Step {n} of {total}”.'}</p>
    </SettingsCard>
  )
}

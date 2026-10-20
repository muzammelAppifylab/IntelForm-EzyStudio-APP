import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { ArrowLeft, Check, CircleAlert, CloudOff, Eye } from 'lucide-react'
import { StatusBadge } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/components/ui/cn'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { PreviewDialog } from './PreviewDialog'
import { PublishButton } from './PublishButton'
import { TABS, type TabId } from './tabs'


/** Header on every tab: title, save state, counts, status, Preview and Publish. */
export function BuilderHeader({ tab }: { tab: TabId }) {
  const formId = useBuilder((s) => s.meta.id)
  const status = useBuilder((s) => s.meta.status)
  const hasUnpublished = useBuilder((s) => s.meta.hasUnpublished)
  const readOnly = useBuilder((s) => s.readOnly)
  const [preview, setPreview] = useState(false)

  return (
    <header className="border-b border-border bg-card">
      <div className="flex h-14 items-center gap-3 px-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to forms">
          <Link to="/dashboard">
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <TitleInput />
        <StatusBadge status={status} />
        {hasUnpublished && status !== 'draft' && <StatusBadge status="unpublished" label="Unpublished changes" />}
        <div className="ml-auto flex items-center gap-2">
          <SaveState />
          <Button variant="secondary" onClick={() => setPreview(true)}>
            <Eye aria-hidden />
            Preview
          </Button>
          {!readOnly && <PublishButton />}
        </div>
      </div>
      <div className="flex h-12 items-center justify-between gap-4 px-3">
        <nav aria-label="Builder" className="flex gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.id}
              to={`/dashboard/forms/${formId}/${t.id}`}
              aria-current={t.id === tab ? 'page' : undefined}
              className={cn(
                'focus-ring rounded-md border-2 border-transparent px-3 py-1.5 text-label whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                t.id === tab && 'border-border-ink bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
              )}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <Counts />
      </div>
      <PreviewDialog open={preview} onOpenChange={setPreview} />
    </header>
  )
}

function TitleInput() {
  const title = useBuilder((s) => s.doc.title)
  const readOnly = useBuilder((s) => s.readOnly)
  const store = useBuilderStore()
  const [text, setText] = useState(title)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(title)
  }, [title])
  const commit = (v: string) => {
    if (v.trim()) store.getState().commit('Rename form', (d) => void (d.title = v.slice(0, 200)), 'title')
  }
  return (
    <input
      aria-label="Form title"
      value={text}
      readOnly={readOnly}
      maxLength={200}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value)
        commit(e.target.value)
      }}
      onBlur={() => {
        focused.current = false
        if (!text.trim()) setText(title)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="focus-ring field-sizing-content max-w-[40ch] min-w-[8ch] truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-subheading text-foreground hover:border-border read-only:hover:border-transparent"
    />
  )
}

function SaveState() {
  const save = useBuilder((s) => s.save)
  const readOnly = useBuilder((s) => s.readOnly)
  if (readOnly) return <span className="text-caption text-muted-foreground">View only</span>
  const { status, error } = save
  const content =
    status === 'saving' || status === 'pending' ? (
      <>
        <Spinner className="size-3.5" />
        Saving…
      </>
    ) : status === 'offline' ? (
      <>
        <CloudOff className="size-3.5" aria-hidden />
        Offline, retrying
      </>
    ) : status === 'error' ? (
      <>
        <CircleAlert className="size-3.5" aria-hidden />
        Not saved
      </>
    ) : (
      <>
        <Check className="size-3.5" aria-hidden />
        Saved
      </>
    )
  const node = (
    <span
      role="status"
      aria-live="polite"
      data-save-status={status}
      className={cn('inline-flex items-center gap-1.5 px-2 text-caption whitespace-nowrap text-muted-foreground', (status === 'error' || status === 'offline') && 'text-destructive')}
    >
      {content}
    </span>
  )
  if (!error || (status !== 'error' && status !== 'offline')) return node
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="focus-ring rounded-sm">
          {node}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{error.message}</TooltipContent>
    </Tooltip>
  )
}

function Counts() {
  const draft = useBuilder((s) => s.doc.draft)
  const responses = useBuilder((s) => s.meta.responses)
  const { fields, rules } = useMemo(
    () => ({ fields: draft.fields.filter((f) => f.type !== 'section_break').length, rules: draft.fields.filter((f) => f.logic).length }),
    [draft],
  )
  const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`
  return (
    <p className="pb-2.5 text-caption text-muted-foreground" aria-label="Form summary">
      {n(fields, 'question', 'questions')} · {n(rules, 'logic rule', 'logic rules')} · {n(responses, 'response', 'responses')}
    </p>
  )
}

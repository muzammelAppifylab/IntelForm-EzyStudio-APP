import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * One floating ink-edged pill on every tab, in three columns so the tabs stay centred whatever the
 * title's length: brand, breadcrumb and editable title | the five tabs as a segmented control |
 * a Draft badge (drafts only), save state, Preview, Publish and the account menu. Unpublished
 * changes show on the Publish button ("Publish changes"), not as a badge.
 */
export function BuilderHeader({ tab }: { tab: TabId }) {
  const formId = useBuilder((s) => s.meta.id)
  const status = useBuilder((s) => s.meta.status)
  const responses = useBuilder((s) => s.meta.responses)
  const readOnly = useBuilder((s) => s.readOnly)
  const [preview, setPreview] = useState(false)

  return (
    <header className="px-3 pt-3 sm:px-4 sm:pt-4">
      {/* Three separate floating cards. Side columns are 1fr each, so the tabs sit at the true centre. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 xl:gap-3">
        <div className="flex h-12 min-w-0 max-w-full items-center gap-1.5 justify-self-start overflow-hidden rounded-xl border border-border bg-card p-1.5 pr-2">
          <Link
            to="/dashboard"
            aria-label="Dashboard"
            className="focus-ring press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-label text-foreground transition-[background-color,scale] duration-(--duration-fast) ease-out hover:bg-accent"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
          <TitleInput />
        </div>

        <BuilderTabs tab={tab} formId={formId} responses={responses} />

        <div className="flex h-12 shrink-0 items-center gap-2 justify-self-end rounded-xl border border-border bg-card p-1.5 pl-3">
          {status === 'draft' && <StatusBadge status="draft" />}
          <SaveState />
          <Button variant="secondary" onClick={() => setPreview(true)} className="h-9 px-2.5 xl:px-3" aria-label="Preview">
            <Eye aria-hidden />
            <span className="hidden xl:inline">Preview</span>
          </Button>
          {!readOnly && <PublishButton className="h-9 px-3.5" />}
        </div>
      </div>
      <PreviewDialog open={preview} onOpenChange={setPreview} />
    </header>
  )
}

/** The five tabs as a segmented control; one indicator slides to the active tab instead of each tab flipping its own fill. */
function BuilderTabs({ tab, formId, responses }: { tab: TabId; formId: string; responses: number }) {
  const navRef = useRef<HTMLElement>(null)
  const [pos, setPos] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
      if (el) setPos({ x: el.offsetLeft, w: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [tab, responses])
  return (
    <nav ref={navRef} aria-label="Builder" className="relative flex h-12 shrink-0 items-center gap-0.5 rounded-xl border border-border bg-card p-1.5">
      {pos && (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 rounded-lg bg-muted transition-[translate,width] duration-(--duration-base) ease-out"
          style={{ translate: `${pos.x}px 0`, width: pos.w }}
        />
      )}
      {TABS.map((t) => (
        <NavLink
          key={t.id}
          to={`/dashboard/forms/${formId}/${t.id}`}
          aria-current={t.id === tab ? 'page' : undefined}
          className={cn(
            'focus-ring press relative inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-label whitespace-nowrap transition-[color,scale] duration-(--duration-fast) ease-out xl:px-3.5',
            t.id === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
          {t.id === 'responses' && responses > 0 && <span className="tabular-nums">{responses.toLocaleString()}</span>}
        </NavLink>
      ))}
    </nav>
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
      title={text}
      value={text}
      readOnly={readOnly}
      maxLength={200}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value)
        commit(e.target.value)
      }}
      onBlur={(e) => {
        focused.current = false
        e.currentTarget.scrollLeft = 0
        if (!text.trim()) setText(title)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="focus-ring field-sizing-content min-w-[6ch] max-w-[min(100%,10rem)] truncate text-ellipsis sm:max-w-[min(100%,14rem)] xl:max-w-[min(100%,20rem)] rounded-md border border-transparent bg-transparent px-2 py-1 text-label font-semibold text-foreground hover:border-border read-only:hover:border-transparent"
    />
  )
}

function SaveState() {
  const save = useBuilder((s) => s.save)
  const readOnly = useBuilder((s) => s.readOnly)
  if (readOnly) return <span className="text-caption text-muted-foreground">View only</span>
  const { status, error } = save
  // Saving and saved are announced to screen readers only; a failed or offline save stays visible.
  const failing = status === 'error' || status === 'offline'
  const content =
    status === 'saving' || status === 'pending' ? (
      <>
        <Spinner className="size-3.5" />
        <span className="sr-only xl:not-sr-only">Saving…</span>
      </>
    ) : status === 'offline' ? (
      <>
        <CloudOff className="size-3.5" aria-hidden />
        <span className="sr-only xl:not-sr-only">Offline, retrying</span>
      </>
    ) : status === 'error' ? (
      <>
        <CircleAlert className="size-3.5" aria-hidden />
        <span className="sr-only xl:not-sr-only">Not saved</span>
      </>
    ) : (
      <>
        <Check className="size-3.5" aria-hidden />
        <span className="sr-only xl:not-sr-only">Saved</span>
      </>
    )
  const node = (
    <span
      role="status"
      aria-live="polite"
      data-save-status={status}
      className={cn('inline-flex items-center gap-1.5 px-2 text-caption whitespace-nowrap text-muted-foreground', failing ? 'text-destructive' : 'sr-only')}
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

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { ConfirmDelete } from './ConfirmDelete'
import { countryLabel, deviceLabel, formatDateTime, formatDuration, formatNumber } from './format'
import { responseDetailQuery, useDeleteResponses, type TableState } from './queries'

/**
 * One response (PRD "response drawer"): answers with labels as submitted, metadata,
 * previous / next within the table's filters (arrows, ←/→ and J/K), delete with confirm.
 * Opened by `?response=<id>`, which owner notification emails link to.
 */
export function ResponseDrawer({
  formId,
  responseId,
  table,
  onNavigate,
  onClose,
}: {
  formId: string
  responseId: string | null
  table: TableState
  onNavigate: (id: string) => void
  onClose: () => void
}) {
  const open = !!responseId
  const { data, error, isPending, isPlaceholderData } = useQuery({
    ...responseDetailQuery(formId, responseId ?? '', table),
    enabled: open,
  })
  const canDelete = useCan('responses.delete')
  const del = useDeleteResponses(formId)
  const [confirm, setConfirm] = useState(false)
  // While the next response loads, the previous one stays on screen (dimmed via aria-busy).
  const detail = data

  useEffect(() => {
    if (!open || !detail) return
    const onKey = (e: KeyboardEvent) => {
      if (confirm || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      const key = e.key.toLowerCase()
      if ((key === 'arrowleft' || key === 'k') && detail.prevId) {
        e.preventDefault()
        onNavigate(detail.prevId)
      } else if ((key === 'arrowright' || key === 'j') && detail.nextId) {
        e.preventDefault()
        onNavigate(detail.nextId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, detail, confirm, onNavigate])

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl" aria-describedby={undefined}>
        <SheetHeader className="gap-3 border-b border-border p-6 pr-14">
          <SheetTitle>Response</SheetTitle>
          <SheetDescription className="tabular-nums">
            {detail ? `${formatNumber(detail.position)} of ${formatNumber(detail.total)} · ${formatDateTime(detail.submittedAt)}` : 'Loading…'}
          </SheetDescription>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Previous response" aria-keyshortcuts="ArrowLeft K" disabled={!detail?.prevId} onClick={() => detail?.prevId && onNavigate(detail.prevId)}>
                  <ChevronLeft aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous (← or K)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Next response" aria-keyshortcuts="ArrowRight J" disabled={!detail?.nextId} onClick={() => detail?.nextId && onNavigate(detail.nextId)}>
                  <ChevronRight aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next (→ or J)</TooltipContent>
            </Tooltip>
            {canDelete && detail && (
              <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6" aria-busy={isPending || isPlaceholderData}>
          {error && !detail ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(error)}</AlertDescription>
            </Alert>
          ) : !detail ? (
            <div className="grid gap-5">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="grid gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-5 w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-8">
              <dl className="grid gap-5">
                {detail.answers.map((a) => (
                  <div key={a.fieldId} className="grid gap-1">
                    <dt className="text-label text-muted-foreground">{a.label}</dt>
                    <dd className="text-body break-words whitespace-pre-line text-foreground">
                      {a.type === 'signature' && a.url ? (
                        <a href={a.url} target="_blank" rel="noreferrer" className="inline-block rounded-md border border-border bg-card p-2">
                          <img src={a.url} alt={`Signature for “${a.label}”`} className="h-24 w-auto" />
                        </a>
                      ) : a.text ? (
                        a.text
                      ) : (
                        <span className="text-muted-foreground">No answer</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <section aria-labelledby="response-meta" className="grid gap-3 border-t border-border pt-6">
                <h3 id="response-meta" className="text-overline text-muted-foreground">
                  Details
                </h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body-sm">
                  <Meta label="Submitted" value={formatDateTime(detail.submittedAt)} />
                  <Meta label="Time taken" value={formatDuration(detail.durationMs)} />
                  <Meta label="Device" value={deviceLabel(detail.device)} />
                  <Meta label="Browser" value={detail.browser ?? '–'} />
                  <Meta label="Country" value={countryLabel(detail.country)} />
                  <Meta label="Form version" value={`Version ${detail.formVersion}`} />
                </dl>
              </section>
            </div>
          )}
        </div>
      </SheetContent>
      {detail && (
        <ConfirmDelete
          open={confirm}
          onOpenChange={setConfirm}
          count={1}
          pending={del.isPending}
          onConfirm={() =>
            del.mutate([detail.id], {
              onSuccess: () => {
                setConfirm(false)
                const go = detail.nextId ?? detail.prevId
                if (go) onNavigate(go)
                else onClose()
              },
            })
          }
        />
      )}
    </Sheet>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </>
  )
}

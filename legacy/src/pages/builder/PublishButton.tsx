import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import type { PublishResponse } from '@shared/api-forms'
import { lintLogic, type LogicIssue } from '@shared/form/logic'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ApiRequestError, errorMessage } from '@/lib/api'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { fieldName } from '@/builder/ops'

interface Problem {
  message: string
  fieldId?: string
}

class PublishBlocked extends Error {
  readonly problems: Problem[]
  constructor(problems: Problem[]) {
    super(problems[0]?.message ?? 'Publishing is blocked')
    this.problems = problems
  }
}

/** POST /publish, keeping the 422 issue list (`api()` drops extra error keys). */
async function postPublish(id: string): Promise<PublishResponse> {
  let res: Response
  try {
    res = await fetch(`/api/forms/${id}/publish`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  } catch {
    throw new ApiRequestError(0, { code: 'offline', message: 'Can’t reach the server. Check your connection and try again.' })
  }
  const body = (await res.json().catch(() => null)) as (PublishResponse & { error?: undefined }) | { error?: { code: string; message: string; issues?: LogicIssue[] } } | null
  if (res.ok) return body as PublishResponse
  const error = body?.error ?? { code: 'unknown', message: 'Publishing failed. Try again.' }
  if (res.status === 422) {
    const issues = error.issues ?? []
    throw new PublishBlocked(issues.length ? issues.map((i) => ({ message: i.message, fieldId: i.fieldId })) : [{ message: error.message }])
  }
  throw new ApiRequestError(res.status, error)
}

/**
 * Publish: the integrity check runs here first (lintLogic, the same check the server repeats
 * and enforces with a 422), then pending edits are saved and the draft becomes a new version.
 */
export function PublishButton({ className }: { className?: string }) {
  const store = useBuilderStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useBuilder((s) => s.meta.status)
  const hasUnpublished = useBuilder((s) => s.meta.hasUnpublished)
  const saveStatus = useBuilder((s) => s.save.status)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<Problem[] | null>(null)

  const upToDate = status !== 'draft' && !hasUnpublished && saveStatus === 'saved'

  function check(): Problem[] {
    const def = store.getState().doc.draft
    const out: Problem[] = []
    if (def.fields.filter((f) => f.type !== 'section_break').length === 0) out.push({ message: 'Add at least one question before you publish.' })
    for (const issue of lintLogic(def)) out.push({ message: issue.message, fieldId: issue.fieldId })
    return out
  }

  async function publish() {
    const local = check()
    if (local.length) return setProblems(local)
    setBusy(true)
    try {
      await store.getState().flush()
      if (store.queue.dirty) throw new Error(store.getState().save.error?.message ?? 'Your latest changes couldn’t be saved, so nothing was published. Try again.')
      const wasLive = store.getState().meta.publishedVersion !== null
      const res = await postPublish(store.getState().meta.id)
      // Publishing moves the revision on; rebase so the next autosave isn't seen as a conflict.
      store.queue.rebase(res.revision)
      store.getState().setMeta({
        status: res.status,
        publishedVersion: res.version,
        publishedAt: res.publishedAt,
        hasUnpublished: false,
        responses: res.responses,
      })
      void queryClient.invalidateQueries({ queryKey: ['forms'], refetchType: 'none' })
      toast.success(wasLive ? 'Changes published' : res.status === 'closed' ? 'Published. The form is still closed.' : 'Published. Your form is live.')
    } catch (err) {
      if (err instanceof PublishBlocked) setProblems(err.problems)
      else toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function goTo(fieldId?: string) {
    setProblems(null)
    if (!fieldId) return
    const s = store.getState()
    s.select(fieldId === 'startScreen' ? 'start' : fieldId === 'endScreen' ? 'end' : fieldId)
    navigate(`/dashboard/forms/${s.meta.id}/build`)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${s.selection}"]`)?.focus())
  }

  const def = store.getState().doc.draft
  const where = (id?: string) => {
    if (!id) return null
    if (id === 'startScreen') return 'Start screen'
    if (id === 'endScreen') return 'End screen'
    const f = def.fields.find((x) => x.id === id)
    return f ? fieldName(def, f) : null
  }

  return (
    <>
      <Button onClick={publish} disabled={busy || upToDate} className={className}>
        {busy ? <Spinner /> : <Rocket aria-hidden />}
        {upToDate ? 'Published' : status === 'draft' ? 'Publish' : 'Publish changes'}
      </Button>
      <Dialog open={problems !== null} onOpenChange={(o) => !o && setProblems(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fix these before you publish</DialogTitle>
            <DialogDescription>Your form is saved as a draft. Publishing is blocked until every problem below is fixed.</DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-80 gap-2 overflow-y-auto" aria-label="Problems">
            {problems?.map((p, i) => (
              <li key={i} className="flex items-start gap-3 rounded-md bg-danger-subtle px-3 py-2.5 text-body-sm text-danger-subtle-foreground">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="grid flex-1 gap-1">
                  <span>{p.message}</span>
                  {where(p.fieldId) && (
                    <Button variant="link" size="xs" className="h-auto justify-start p-0 text-danger-subtle-foreground underline" onClick={() => goTo(p.fieldId)}>
                      Go to {where(p.fieldId)}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setProblems(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

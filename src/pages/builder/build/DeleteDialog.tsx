import { dependentsOf } from '@shared/form/logic'
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
import { buttonVariants } from '@/components/ui/button'
import { describeRule } from '@/builder/describe'
import { fieldName } from '@/builder/ops'
import { useBuilder, useBuilderStore } from '@/builder/store'

/** PRD: deleting a field that rules depend on warns first and lists those rules. */
export function DeleteDialog() {
  const store = useBuilderStore()
  const pending = useBuilder((s) => s.pendingDelete)
  const draft = useBuilder((s) => s.doc.draft)
  const field = draft.fields.find((f) => f.id === pending)
  const deps = pending ? dependentsOf(draft, pending) : []
  const name = field ? fieldName(draft, field) : ''

  const describe = (d: (typeof deps)[number]) => {
    if (d.fieldId === 'startScreen') return { where: 'Start screen', what: `shows the answer to ${name}` }
    if (d.fieldId === 'endScreen') return { where: 'End screen', what: `shows the answer to ${name}` }
    const f = draft.fields.find((x) => x.id === d.fieldId)
    if (!f) return { where: 'A question', what: '' }
    return { where: fieldName(draft, f), what: d.via === 'logic' && f.logic ? describeRule(draft, f.logic) : `Shows the answer to ${name}` }
  }

  return (
    <AlertDialog open={!!field} onOpenChange={(o) => !o && store.getState().cancelDelete()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Other parts of the form use this question. Deleting it removes those conditions and answer chips. You can undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-2" aria-label="Depends on this question">
          {deps.map((d, i) => {
            const { where, what } = describe(d)
            return (
              <li key={i} className="grid gap-0.5 rounded-md border border-border px-3 py-2">
                <span className="text-label text-foreground">{where}</span>
                <span className="text-body-sm text-muted-foreground">{what}</span>
              </li>
            )
          })}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={() => pending && store.getState().remove(pending)}>
            Delete question
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

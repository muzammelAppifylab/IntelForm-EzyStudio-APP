import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export function ConfirmDelete({
  open,
  onOpenChange,
  count,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  pending: boolean
  onConfirm: () => void
}) {
  const one = count === 1
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{one ? 'Delete this response?' : `Delete ${count} responses?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {one ? 'Its answers are removed for good' : 'Their answers are removed for good'} and the summary updates. Export a CSV first if you need a copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {/* A plain button: AlertDialogAction would close before the request finishes. */}
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? 'Deleting…' : one ? 'Delete response' : `Delete ${count} responses`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

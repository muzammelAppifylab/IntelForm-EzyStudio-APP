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
import { Spinner } from '@/components/ui/spinner'
import { formatNumber, plural } from './format'

/** Erasing a contact deletes every response they sent, on every form. Says so in numbers. */
export function ConfirmDeleteContacts({
  open,
  onOpenChange,
  contacts,
  responses,
  name,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contacts: number
  responses: number
  /** Shown for a single contact. */
  name?: string
  pending: boolean
  onConfirm: () => void
}) {
  const one = contacts === 1
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{one ? `Delete ${name ?? 'this contact'}?` : `Delete ${formatNumber(contacts)} contacts?`}</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {responses === 1 ? 'the 1 response' : `all ${plural(responses, 'response')}`} from {one ? 'this contact' : 'these contacts'} across all forms. Form summaries and
            counts update, and it can’t be undone. Export a CSV first if you need a copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {/* A plain button: AlertDialogAction would close before the request finishes. */}
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending && <Spinner />}
            {pending ? 'Deleting…' : one ? 'Delete contact' : `Delete ${formatNumber(contacts)} contacts`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

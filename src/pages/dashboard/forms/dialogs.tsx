import { TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { renameFormInput, saveAsTemplateInput, type FormListItem } from '@shared/api-forms'
import { Field, FormError } from '@/components/common/Field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useFormErrors } from '@/lib/form-errors'
import { formatCount } from './format'
import { useCreateForm, useDeleteForm, useRenameForm, useSaveAsTemplate } from './queries'
import { TemplatePicker } from './TemplatePicker'

export type FormDialog =
  | { kind: 'new' }
  | { kind: 'rename'; form: FormListItem }
  | { kind: 'delete'; form: FormListItem }
  | { kind: 'template'; form: FormListItem }
  | null

export function FormDialogs({ dialog, onClose }: { dialog: FormDialog; onClose: () => void }) {
  if (!dialog) return null
  switch (dialog.kind) {
    case 'new':
      return <NewFormDialog onClose={onClose} />
    case 'rename':
      return <RenameDialog form={dialog.form} onClose={onClose} />
    case 'delete':
      return <DeleteDialog form={dialog.form} onClose={onClose} />
    case 'template':
      return <SaveTemplateDialog form={dialog.form} onClose={onClose} />
  }
}

export function NewFormDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateForm()
  const [pending, setPending] = useState<string | null>(null)

  function start(id: string, input: { templateId?: string }) {
    setPending(id)
    create.mutate(input, { onError: () => setPending(null) })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[min(44rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>Start from scratch or from a template. You can change everything afterwards.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 overflow-y-auto px-6 pb-1">
          <TemplatePicker pendingId={pending} onBlank={() => start('blank', {})} onTemplate={(t) => start(t.id, { templateId: t.id })} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ form, onClose }: { form: FormListItem; onClose: () => void }) {
  const errors = useFormErrors()
  const [title, setTitle] = useState(form.title)
  const rename = useRenameForm(onClose)

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(renameFormInput, { title })
    if (input) rename.mutate({ id: form.id, title: input.title }, { onError: errors.fromError })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename form</DialogTitle>
            <DialogDescription>The title shows in the dashboard and at the top of the public form.</DialogDescription>
          </DialogHeader>
          <FormError message={errors.form} />
          <Field label="Title" error={errors.fields.title}>
            {(p) => <Input {...p} autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={rename.isPending}>{rename.isPending ? 'Saving…' : 'Rename'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ form, onClose }: { form: FormListItem; onClose: () => void }) {
  const errors = useFormErrors()
  const [typed, setTyped] = useState('')
  const remove = useDeleteForm(onClose)
  const matches = typed.trim() === form.title.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!matches) return
    remove.mutate({ id: form.id, confirmTitle: typed }, { onError: errors.fromError })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Delete this form?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-foreground">{form.title}</span>, every published version and its public link.
            </DialogDescription>
          </DialogHeader>
          <div role="note" className="flex items-start gap-2 rounded-md bg-danger-subtle px-3 py-2.5 text-body-sm text-danger-subtle-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {form.responseCount > 0
                ? `Its ${formatCount(form.responseCount)} ${form.responseCount === 1 ? 'response is' : 'responses are'} deleted too. Export them first if you need them.`
                : 'Any responses are deleted too.'}{' '}
              You can’t undo this.
            </span>
          </div>
          <FormError message={errors.form} />
          <Field label={`Type “${form.title}” to confirm`} error={errors.fields.confirmTitle}>
            {(p) => <Input {...p} autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!matches || remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete form'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SaveTemplateDialog({ form, onClose }: { form: FormListItem; onClose: () => void }) {
  const errors = useFormErrors()
  const [values, setValues] = useState({ name: form.title, description: '' })
  const save = useSaveAsTemplate(onClose)

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(saveAsTemplateInput, values)
    if (input) save.mutate({ id: form.id, ...input }, { onError: errors.fromError })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Your whole team can start new forms from it. Questions, design and settings are copied; responses, the password and webhook are not.
            </DialogDescription>
          </DialogHeader>
          <FormError message={errors.form} />
          <Field label="Template name" error={errors.fields.name}>
            {(p) => <Input {...p} autoFocus maxLength={120} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />}
          </Field>
          <Field label="Description" description="Optional. Shown on the template card." error={errors.fields.description}>
            {(p) => <Input {...p} maxLength={300} value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save template'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

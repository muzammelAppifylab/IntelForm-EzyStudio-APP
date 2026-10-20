import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutTemplate, MoreHorizontal } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { templatePatchInput, type TemplateSummary } from '@shared/api-forms'
import { Field, FormError } from '@/components/common/Field'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { useFormErrors } from '@/lib/form-errors'
import { templatesQuery, useCreateForm } from './forms/queries'
import { groupByCategory } from './forms/format'
import { TemplateCard } from './forms/TemplatePicker'

type Dialogs = { kind: 'rename'; template: TemplateSummary } | { kind: 'delete'; template: TemplateSummary } | null

export default function TemplatesPage() {
  const canUse = useCan('forms.edit')
  const canManage = useCan('templates.edit')
  const templates = useQuery(templatesQuery)
  const create = useCreateForm()
  const [pending, setPending] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialogs>(null)

  function use(t: TemplateSummary) {
    setPending(t.id)
    create.mutate({ templateId: t.id }, { onError: () => setPending(null) })
  }

  const groups = templates.data ? groupByCategory(templates.data.templates, templates.data.categories) : []
  const saved = templates.data?.templates.filter((t) => !t.isBuiltin) ?? []

  return (
    <div className="@container grid gap-8">
      <PageHeader
        title="Templates"
        description={
          canUse
            ? 'Start a form from a ready-made template, or from one your team saved.'
            : 'Ready-made forms and the ones your team saved. Owners and Editors can start new forms from them.'
        }
      />

      {templates.isPending && (
        <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      )}

      {templates.isError && (
        <section role="alert" className="grid justify-items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
          <h2 className="text-subheading">Templates didn’t load</h2>
          <p className="text-body text-muted-foreground">{errorMessage(templates.error)}</p>
          <Button variant="outline" onClick={() => templates.refetch()}>Try again</Button>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.category} className="grid gap-3" aria-label={g.category}>
          <h2 className="text-subheading">{g.category}</h2>
          <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
            {g.items.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onUse={canUse ? () => use(t) : undefined}
                busy={pending === t.id}
                disabled={pending !== null}
                menu={!t.isBuiltin && canManage ? <TemplateMenu template={t} onDialog={setDialog} /> : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      {templates.data && saved.length === 0 && canManage && (
        <section className="flex items-start gap-3 rounded-lg border border-dashed border-input bg-card p-5">
          <LayoutTemplate className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-body-sm text-muted-foreground">
            Your team’s own templates appear here. On the Forms page, open a form’s menu and choose “Save as template”.
          </p>
        </section>
      )}

      {dialog?.kind === 'rename' && <RenameTemplateDialog template={dialog.template} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteTemplateDialog template={dialog.template} onClose={() => setDialog(null)} />}
    </div>
  )
}

function TemplateMenu({ template, onDialog }: { template: TemplateSummary; onDialog: (d: Dialogs) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2" aria-label={`Actions for ${template.name}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onDialog({ kind: 'rename', template })}>Rename</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => onDialog({ kind: 'delete', template })}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RenameTemplateDialog({ template, onClose }: { template: TemplateSummary; onClose: () => void }) {
  const queryClient = useQueryClient()
  const errors = useFormErrors()
  const [values, setValues] = useState({ name: template.name, description: template.description })
  const rename = useMutation({
    mutationFn: (input: { name: string; description?: string }) => api(`/api/templates/${template.id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      toast.success('Template renamed')
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      onClose()
    },
    onError: errors.fromError,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = errors.validate(templatePatchInput, values)
    if (input) rename.mutate(input)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename template</DialogTitle>
            <DialogDescription>Forms already made from it keep their own titles.</DialogDescription>
          </DialogHeader>
          <FormError message={errors.form} />
          <Field label="Name" error={errors.fields.name}>
            {(p) => <Input {...p} autoFocus maxLength={120} value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />}
          </Field>
          <Field label="Description" error={errors.fields.description}>
            {(p) => <Input {...p} maxLength={300} value={values.description} onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))} />}
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

function DeleteTemplateDialog({ template, onClose }: { template: TemplateSummary; onClose: () => void }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api(`/api/templates/${template.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Template deleted')
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{template.name}”?</DialogTitle>
          <DialogDescription>It’s removed for the whole team. Forms already made from it aren’t affected.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

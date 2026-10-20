import { formatDistanceToNowStrict } from 'date-fns'
import {
  BarChart3,
  CopyPlus,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  PencilLine,
  PenSquare,
  Save,
  Trash2,
} from 'lucide-react'
import { Link } from 'react-router'
import type { FormListItem } from '@shared/api-forms'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/lib/auth'
import { FormStatusBadge, LayoutIcon, UnpublishedBadge } from './bits'
import { formatCount, formatRate } from './format'
import type { FormDialog } from './dialogs'
import { builderPath, responsesPath, useFormActions } from './queries'

type OnDialog = (d: FormDialog) => void

function updatedAgo(iso: string) {
  return `${formatDistanceToNowStrict(new Date(iso))} ago`
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function FormActionsMenu({ form, onDialog }: { form: FormListItem; onDialog: OnDialog }) {
  const canEdit = useCan('forms.edit')
  const canTemplate = useCan('templates.edit')
  const actions = useFormActions()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${form.title}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to={builderPath(form.id)}><PenSquare aria-hidden /> {canEdit ? 'Open builder' : 'Open form'}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={responsesPath(form.id)}><BarChart3 aria-hidden /> View responses</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.copyLink(form)}><Link2 aria-hidden /> Copy link</DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.duplicate.mutate(form)}><CopyPlus aria-hidden /> Duplicate</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDialog({ kind: 'rename', form })}><PencilLine aria-hidden /> Rename</DropdownMenuItem>
            {canTemplate && (
              <DropdownMenuItem onSelect={() => onDialog({ kind: 'template', form })}><Save aria-hidden /> Save as template</DropdownMenuItem>
            )}
            {form.status === 'live' && (
              <DropdownMenuItem onSelect={() => actions.close.mutate(form)}><Lock aria-hidden /> Close form</DropdownMenuItem>
            )}
            {form.status === 'closed' && (
              <DropdownMenuItem onSelect={() => actions.reopen.mutate(form)}><LockOpen aria-hidden /> Reopen form</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDialog({ kind: 'delete', form })}><Trash2 aria-hidden /> Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Badges({ form }: { form: FormListItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FormStatusBadge status={form.status} />
      {form.hasUnpublished && <UnpublishedBadge />}
    </div>
  )
}

export function FormsGrid({ forms, onDialog }: { forms: FormListItem[]; onDialog: OnDialog }) {
  return (
    <ul className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3" aria-label="Forms">
      {forms.map((form) => (
        <li key={form.id} className="group relative flex flex-col gap-4 rounded-lg border bg-card p-5 transition-colors hover:border-input">
          <div className="flex items-start gap-3">
            <LayoutIcon layout={form.layout} />
            <div className="grid min-w-0 flex-1 gap-1.5">
              <h3 className="line-clamp-2 text-subheading break-words">
                {/* The title link covers the card; the menu sits above it. */}
                <Link to={builderPath(form.id)} className="focus-ring rounded-sm after:absolute after:inset-0 after:rounded-lg after:content-['']">
                  {form.title}
                </Link>
              </h3>
              <Badges form={form} />
            </div>
            <div className="relative -mt-1 -mr-2">
              <FormActionsMenu form={form} onDialog={onDialog} />
            </div>
          </div>
          <div className="mt-auto grid gap-4">
          <dl className="grid grid-cols-2 gap-3 border-t pt-4">
            <div className="grid gap-0.5">
              <dt className="text-caption text-muted-foreground">Responses</dt>
              <dd className="text-subheading tabular-nums">{formatCount(form.responseCount)}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-caption text-muted-foreground">Completion</dt>
              <dd className="text-subheading tabular-nums">{formatRate(form.completionRate)}</dd>
            </div>
          </dl>
          <p className="text-caption text-muted-foreground">
            Updated <time dateTime={form.updatedAt} title={fullDate(form.updatedAt)}>{updatedAgo(form.updatedAt)}</time>
          </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function FormsTable({ forms, onDialog }: { forms: FormListItem[]; onDialog: OnDialog }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label="Forms">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Form</TableHead>
            <TableHead className="hidden @3xl:table-cell">Status</TableHead>
            <TableHead className="text-right">Responses</TableHead>
            <TableHead className="hidden text-right @lg:table-cell">Completion</TableHead>
            <TableHead className="hidden @4xl:table-cell">Updated</TableHead>
            <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {forms.map((form) => (
            <TableRow key={form.id}>
              <TableCell className="max-w-0 w-full">
                <div className="flex min-w-0 items-center gap-3">
                  <LayoutIcon layout={form.layout} className="size-8" />
                  <div className="grid min-w-0 gap-1">
                    <Link to={builderPath(form.id)} className="focus-ring truncate rounded-sm text-label hover:underline">
                      {form.title}
                    </Link>
                    <div className="@3xl:hidden"><Badges form={form} /></div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden @3xl:table-cell"><Badges form={form} /></TableCell>
              <TableCell className="text-right text-body-sm tabular-nums">{formatCount(form.responseCount)}</TableCell>
              <TableCell className="hidden text-right text-body-sm tabular-nums @lg:table-cell">{formatRate(form.completionRate)}</TableCell>
              <TableCell className="hidden text-body-sm whitespace-nowrap text-muted-foreground @4xl:table-cell">
                <time dateTime={form.updatedAt} title={fullDate(form.updatedAt)}>{updatedAgo(form.updatedAt)}</time>
              </TableCell>
              <TableCell><FormActionsMenu form={form} onDialog={onDialog} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}


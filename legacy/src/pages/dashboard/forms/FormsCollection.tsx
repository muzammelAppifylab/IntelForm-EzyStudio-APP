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
  Rows3,
  Save,
  Trash2,
} from 'lucide-react'
import { Link } from 'react-router'
import type { FormListItem } from '@shared/api-forms'
import { LAYOUT_LABEL } from '@shared/form/definition'
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
import { formatCount, formatRate, LAYOUT_ICON } from './format'
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
    <ul className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Forms">
      {forms.map((form, i) => {
        const Layout = LAYOUT_ICON[form.layout] ?? Rows3
        const empty = form.status === 'draft' && form.responseCount === 0
        return (
          <li
            key={form.id}
            style={{ '--i': i } as React.CSSProperties}
            className="stagger group relative flex flex-col rounded-lg border border-border bg-card p-4 transition-[border-color] duration-(--duration-fast) ease-out focus-within:border-ring hover:border-paper-400 hover:bg-card"
          >
            <div className="flex items-start justify-between gap-3">
              <Badges form={form} />
              {/* Above the title link's card-wide overlay, which comes later in the DOM. */}
              <div className="relative z-10 -mt-1 -mr-1.5">
                <FormActionsMenu form={form} onDialog={onDialog} />
              </div>
            </div>
            <h3 className="mt-3 line-clamp-2 text-subheading break-words">
              {/* The title link covers the card; the menu sits above it. */}
              <Link to={builderPath(form.id)} className="focus-ring rounded-sm after:absolute after:inset-0 after:rounded-lg after:content-['']">
                {form.title}
              </Link>
            </h3>
            <p className="mt-1 mb-5 inline-flex items-center gap-1.5 text-caption text-muted-foreground">
              <Layout className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">Layout: </span>
              {LAYOUT_LABEL[form.layout] ?? 'All at once'}
            </p>
            <dl className="mt-auto grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="grid gap-0.5">
                <dt className="order-last text-caption text-muted-foreground">Responses</dt>
                <dd className="text-heading-sm tabular-nums">{empty ? '—' : formatCount(form.responseCount)}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="order-last text-caption text-muted-foreground">Completion</dt>
                <dd className="text-heading-sm tabular-nums">{formatRate(form.completionRate)}</dd>
              </div>
            </dl>
            <div className="mt-3 flex min-h-5 items-center justify-between gap-3">
              <p className="text-caption text-muted-foreground">
                Edited <time dateTime={form.updatedAt} title={fullDate(form.updatedAt)}>{updatedAgo(form.updatedAt)}</time>
              </p>
              {form.newThisWeek > 0 && (
                <span className="rounded-md bg-info-subtle px-2 py-0.5 text-caption font-semibold tabular-nums text-info-subtle-foreground">
                  +{formatCount(form.newThisWeek)} new
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function FormsTable({ forms, onDialog }: { forms: FormListItem[]; onDialog: OnDialog }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Forms">
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


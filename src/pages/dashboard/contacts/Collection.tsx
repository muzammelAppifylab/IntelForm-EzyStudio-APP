import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, Eye, MoreHorizontal, Trash2 } from 'lucide-react'
import type { ContactRow, ContactSort } from '@shared/api-contacts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ContactAvatar, Country, FormChips } from './bits'
import { contactSubtitle, contactTitle, formatDate, formatNumber, formatPhone, fullDate, plural, relative } from './format'
import { copyText, type ColumnId, type ContactsView } from './queries'

export interface CollectionProps {
  contacts: ContactRow[]
  selected: Map<string, ContactRow>
  onSelect: (rows: ContactRow[], on: boolean) => void
  onOpen: (key: string) => void
  onDelete: ((rows: ContactRow[]) => void) | null
  csvFor: (keys: string[]) => string
  activeKey: string | null
}

export function RowActions({ contact, onOpen, onDelete, csvFor }: { contact: ContactRow } & Pick<CollectionProps, 'onOpen' | 'onDelete' | 'csvFor'>) {
  const title = contactTitle(contact)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${title}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onOpen(contact.key)}>
          <Eye aria-hidden /> View details
        </DropdownMenuItem>
        {contact.email && (
          <DropdownMenuItem onSelect={() => void copyText(contact.email!, 'Email copied')}>
            <Copy aria-hidden /> Copy email
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href={csvFor([contact.key])} download>
            <Download aria-hidden /> Export CSV
          </a>
        </DropdownMenuItem>
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete([contact])}>
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function When({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={fullDate(iso)} className={className}>
      {relative(iso)}
    </time>
  )
}

/** Header that sorts by its column; the second click flips the direction. */
function SortHead({ id, label, sort, dir, onSort, className }: { id: ContactSort; label: string; sort: ContactSort; dir: 'asc' | 'desc'; onSort: (s: ContactSort) => void; className?: string }) {
  const active = sort === id
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={className}>
      <button
        type="button"
        onClick={() => onSort(id)}
        className={cn(
          'focus-ring -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 transition-colors duration-(--duration-fast) ease-out hover:text-foreground',
          active && 'text-foreground',
          className?.includes('text-right') && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('size-3.5 shrink-0', !active && 'opacity-40')} aria-hidden />
      </button>
    </TableHead>
  )
}

export function ContactsTable({
  contacts,
  selected,
  onSelect,
  onOpen,
  onDelete,
  csvFor,
  activeKey,
  hidden,
  sort,
  dir,
  onSort,
}: CollectionProps & { hidden: ColumnId[]; sort: ContactSort; dir: 'asc' | 'desc'; onSort: (s: ContactSort) => void }) {
  const show = (c: ColumnId) => !hidden.includes(c)
  const all = contacts.length > 0 && contacts.every((c) => selected.has(c.key))
  const some = contacts.some((c) => selected.has(c.key))
  const sortProps = { sort, dir, onSort }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label="Contacts">
      <Table className="min-w-[44rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pl-4">
              <Checkbox
                aria-label="Select all on this page"
                checked={all ? true : some ? 'indeterminate' : false}
                onCheckedChange={(v) => onSelect(contacts, !!v)}
              />
            </TableHead>
            <SortHead id="name" label="Contact" {...sortProps} />
            {show('phone') && <TableHead>Phone</TableHead>}
            {show('country') && <TableHead>Country</TableHead>}
            {show('forms') && <TableHead>Forms</TableHead>}
            {show('responses') && <SortHead id="responses" label="Responses" className="text-right" {...sortProps} />}
            {show('firstSeen') && <SortHead id="first_seen" label="First seen" {...sortProps} />}
            {show('lastSeen') && <SortHead id="last_seen" label="Last active" {...sortProps} />}
            <TableHead className="w-12 pr-3">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => {
            const title = contactTitle(c)
            const sub = contactSubtitle(c)
            const isSelected = selected.has(c.key)
            return (
              <TableRow
                key={c.key}
                data-state={isSelected || c.key === activeKey ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => onOpen(c.key)}
              >
                <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`Select ${title}`} checked={isSelected} onCheckedChange={(v) => onSelect([c], !!v)} />
                </TableCell>
                <TableCell className="max-w-72 min-w-48">
                  <div className="flex min-w-0 items-center gap-3">
                    <ContactAvatar contact={c} />
                    <div className="grid min-w-0">
                      <button
                        type="button"
                        className="focus-ring max-w-full cursor-pointer truncate rounded-sm text-left text-label text-foreground hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(c.key)
                        }}
                      >
                        {title}
                      </button>
                      {sub && <span className="truncate text-caption text-muted-foreground">{sub}</span>}
                    </div>
                  </div>
                </TableCell>
                {show('phone') && <TableCell className="tabular-nums">{c.phone ? formatPhone(c.phone) : <span className="text-muted-foreground">–</span>}</TableCell>}
                {show('country') && (
                  <TableCell className="max-w-40">
                    <Country code={c.country} className="max-w-full" />
                  </TableCell>
                )}
                {show('forms') && (
                  <TableCell className="max-w-60 whitespace-normal">
                    <FormChips forms={c.forms} total={c.formCount} limit={1} className="flex-nowrap" />
                  </TableCell>
                )}
                {show('responses') && <TableCell className="text-right tabular-nums">{formatNumber(c.responseCount)}</TableCell>}
                {show('firstSeen') && (
                  <TableCell className="text-muted-foreground">
                    <time dateTime={c.firstSeen} title={fullDate(c.firstSeen)}>
                      {formatDate(c.firstSeen)}
                    </time>
                  </TableCell>
                )}
                {show('lastSeen') && (
                  <TableCell className="text-muted-foreground">
                    <When iso={c.lastSeen} />
                  </TableCell>
                )}
                <TableCell className="pr-3" onClick={(e) => e.stopPropagation()}>
                  <RowActions contact={c} onOpen={onOpen} onDelete={onDelete} csvFor={csvFor} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

export function ContactsCards({ contacts, selected, onSelect, onOpen, onDelete, csvFor, activeKey }: CollectionProps) {
  return (
    <ul className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-3" aria-label="Contacts">
      {contacts.map((c) => {
        const title = contactTitle(c)
        const sub = contactSubtitle(c)
        const isSelected = selected.has(c.key)
        return (
          <li
            key={c.key}
            className={cn(
              'group relative flex flex-col gap-4 rounded-lg border bg-card p-5 transition-[border-color] duration-(--duration-fast) ease-out focus-within:border-border-ink hover:border-border-ink',
              isSelected || c.key === activeKey ? 'border-border-ink' : 'border-border',
            )}
          >
            <div className="flex items-start gap-3">
              <ContactAvatar contact={c} size="lg" className="size-10" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <h3 className="truncate text-subheading">
                  {/* The name covers the card; the checkbox and menu sit above it. */}
                  <button
                    type="button"
                    onClick={() => onOpen(c.key)}
                    className="focus-ring cursor-pointer rounded-sm text-left after:absolute after:inset-0 after:rounded-lg after:content-['']"
                  >
                    {title}
                  </button>
                </h3>
                {sub && <p className="truncate text-body-sm text-muted-foreground">{sub}</p>}
              </div>
              <div className="relative z-10 -mt-1 -mr-1 flex items-center gap-1">
                <Checkbox aria-label={`Select ${title}`} checked={isSelected} onCheckedChange={(v) => onSelect([c], !!v)} className="mr-1" />
                <RowActions contact={c} onOpen={onOpen} onDelete={onDelete} csvFor={csvFor} />
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm">
              <div className="grid min-w-0 gap-0.5">
                <dt className="text-caption text-muted-foreground">Phone</dt>
                <dd className="truncate tabular-nums">{c.phone ? formatPhone(c.phone) : '–'}</dd>
              </div>
              <div className="grid min-w-0 gap-0.5">
                <dt className="text-caption text-muted-foreground">Country</dt>
                <dd className="min-w-0">
                  <Country code={c.country} className="max-w-full" />
                </dd>
              </div>
            </dl>

            <FormChips forms={c.forms} total={c.formCount} />

            <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-caption text-muted-foreground">
              <span className="tabular-nums">{plural(c.responseCount, 'response')}</span>
              <span>
                Active <When iso={c.lastSeen} />
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** "3 selected · Export CSV · Delete · Clear selection". */
export function BulkBar({ count, csvHref, onDelete, onClear }: { count: number; csvHref: string; onDelete: (() => void) | null; onClear: () => void }) {
  return (
    <div
      role="region"
      aria-label="Selection"
      className="sticky bottom-4 z-20 flex animate-fade-up flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-body-sm"
    >
      <span className="mr-auto text-label tabular-nums">{formatNumber(count)} selected</span>
      <Button asChild variant="outline" size="sm">
        <a href={csvHref} download>
          <Download aria-hidden />
          Export CSV
        </a>
      </Button>
      {onDelete && (
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 aria-hidden />
          Delete
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  )
}

export function CollectionSkeleton({ view }: { view: ContactsView }) {
  if (view === 'cards') {
    return (
      <div className="grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-52 rounded-lg" />
        ))}
      </div>
    )
  }
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-card" aria-hidden>
      <Skeleton className="h-10 rounded-none" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="hidden h-3.5 w-24 sm:block" />
          <Skeleton className="hidden h-3.5 w-20 md:block" />
        </div>
      ))}
    </div>
  )
}

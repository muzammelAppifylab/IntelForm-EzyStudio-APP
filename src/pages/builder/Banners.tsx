import { Eye, RefreshCw, TriangleAlert, Users, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { useBuilder, useBuilderStore } from '@/builder/store'

function Banner({ tone, icon, children, action }: { tone: 'info' | 'warning' | 'danger'; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2 text-body-sm',
        tone === 'info' && 'border-info-subtle bg-info-subtle text-info-subtle-foreground',
        tone === 'warning' && 'border-warning-subtle bg-warning-subtle text-warning-subtle-foreground',
        tone === 'danger' && 'border-danger-subtle bg-danger-subtle text-danger-subtle-foreground',
      )}
    >
      <span className="shrink-0 [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  )
}

function names(list: { name: string; self: boolean }[]): string {
  const people = list.map((o) => (o.self ? 'You, in another tab,' : o.name))
  if (people.length === 1) return people[0]
  return `${people.slice(0, -1).join(', ')} and ${people.at(-1)}`
}

/** Read-only, other editors, overwritten saves, newer versions and save errors. */
export function Banners() {
  const store = useBuilderStore()
  const readOnly = useBuilder((s) => s.readOnly)
  const others = useBuilder((s) => s.others)
  const banner = useBuilder((s) => s.banner)
  const save = useBuilder((s) => s.save)

  return (
    <div>
      {readOnly && (
        <Banner tone="info" icon={<Eye />}>
          You can look at this form but not change it. Ask the Owner for Editor access to make changes.
        </Banner>
      )}
      {!readOnly && others.length > 0 && (
        <Banner tone="warning" icon={<Users />}>
          {names(others)} {others.length === 1 && !others[0].self ? 'is' : 'are'} also editing this form. The last save wins, so agree who edits what.
        </Banner>
      )}
      {banner?.kind === 'overwrote' && (
        <Banner
          tone="warning"
          icon={<TriangleAlert />}
          action={
            <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => store.getState().setBanner(null)}>
              <X aria-hidden />
            </Button>
          }
        >
          {banner.name} also edited this form. Your version replaced theirs.
        </Banner>
      )}
      {banner?.kind === 'newer' && (
        <Banner
          tone="info"
          icon={<RefreshCw />}
          action={
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => location.reload()}>
                Reload
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => store.getState().setBanner(null)}>
                <X aria-hidden />
              </Button>
            </div>
          }
        >
          {banner.name} saved a newer version. Reload to see it; if you keep editing, your next save replaces theirs.
        </Banner>
      )}
      {save.status === 'error' && save.error && (
        <Banner tone="danger" icon={<TriangleAlert />}>
          Your latest changes aren’t saved: {save.error.message}
          {save.error.status === 422 ? ' Undo the last change or fix it to save again.' : ''}
        </Banner>
      )}
    </div>
  )
}

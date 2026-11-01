import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ContactFormRef, ContactRow } from '@shared/api-contacts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { contactInitials, countryLabel, formatNumber } from './format'
import { copyText } from './queries'

/** Initials in a round tile. */
export function ContactAvatar({ contact, size = 'default', className }: { contact: Pick<ContactRow, 'name' | 'email' | 'phone'>; size?: 'default' | 'lg'; className?: string }) {
  return (
    <Avatar size={size} className={className} aria-hidden>
      <AvatarFallback className={cn('bg-accent text-accent-foreground', size === 'lg' && 'text-subheading')}>{contactInitials(contact)}</AvatarFallback>
    </Avatar>
  )
}

/** Flag SVGs load one by one as small chunks, the same way the phone input does. */
const FLAGS = import.meta.glob<string>('/node_modules/country-flag-icons/string/3x2/*.js', { import: 'default' })
const flagCache = new Map<string, string>()

export function CountryFlag({ code, className }: { code: string; className?: string }) {
  const [, setLoaded] = useState(0)
  const svg = flagCache.get(code) ?? null
  useEffect(() => {
    if (flagCache.has(code)) return
    let alive = true
    FLAGS[`/node_modules/country-flag-icons/string/3x2/${code}.js`]?.()
      .then((s) => {
        flagCache.set(code, s)
        if (alive) setLoaded((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [code])
  return (
    <span aria-hidden className={cn('block h-3.5 w-5 shrink-0 overflow-hidden rounded-xs bg-muted ring-1 ring-border', className)}>
      {svg && <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} className="size-full object-cover" />}
    </span>
  )
}

export function Country({ code, className }: { code: string | null; className?: string }) {
  if (!code) return <span className={cn('text-muted-foreground', className)}>–</span>
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <CountryFlag code={code} />
      <span className="truncate">{countryLabel(code)}</span>
    </span>
  )
}

/** Up to `limit` (3) form titles as small pills, then "+N". */
export function FormChips({ forms, total, limit = 3, className }: { forms: ContactFormRef[]; total: number; limit?: number; className?: string }) {
  const shown = forms.slice(0, limit)
  const more = Math.max(0, total - shown.length)
  if (total === 0) return <span className="text-muted-foreground">–</span>
  return (
    <ul className={cn('flex min-w-0 flex-wrap items-center gap-1', className)} aria-label={`${formatNumber(total)} ${total === 1 ? 'form' : 'forms'}`}>
      {shown.map((f) => (
        <li key={f.id} className="max-w-36 truncate rounded-md border border-border bg-background px-2 py-0.5 text-caption text-foreground" title={f.title}>
          {f.title}
        </li>
      ))}
      {more > 0 && (
        <li className="rounded-md bg-muted px-2 py-0.5 text-caption font-medium tabular-nums text-muted-foreground">
          +{formatNumber(more)}
          <span className="sr-only"> more</span>
        </li>
      )}
    </ul>
  )
}

/** Small icon button that copies a value and says so. */
export function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={async () => {
            if (await copyText(value, done)) setCopied(true)
          }}
        >
          {copied ? <Check className="animate-pop-in text-pine" aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

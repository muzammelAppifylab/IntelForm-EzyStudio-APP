import { cn } from '@/components/ui/cn'

/**
 * The creator's uploaded logo. No logo glyph ships with the design system: without an upload
 * this renders nothing, and callers set the app name in plain type beside it.
 */
export function Logo({ logoUrl, appName, className }: { logoUrl?: string | null; appName: string; className?: string }) {
  if (!logoUrl) return null
  return <img src={logoUrl} alt={appName} className={cn('size-8 shrink-0 rounded-md object-contain', className)} />
}

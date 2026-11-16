import { Spinner } from '@/components/ui/spinner'

export function FullPageSpinner() {
  return (
    <div className="grid min-h-svh place-items-center" role="status">
      <Spinner className="size-6 text-muted-foreground" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

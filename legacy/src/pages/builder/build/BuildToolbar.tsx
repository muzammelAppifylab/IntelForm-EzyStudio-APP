import { Plus, Redo2, Undo2 } from 'lucide-react'
import { LAYOUTS, type Layout } from '@shared/form/definition'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useBuilder, useBuilderStore } from '@/builder/store'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

const SHORT_LAYOUT: Record<Layout, string> = { all_at_once: 'All at once', section_by_section: 'Sections', one_at_a_time: 'One at a time' }

/** Floating ink pill under the canvas: undo and redo, the layout switch and Add question. */
export function BuildToolbar({ onInsert }: { onInsert(): void }) {
  const store = useBuilderStore()
  const readOnly = useBuilder((s) => s.readOnly)
  const canUndo = useBuilder((s) => s.past.length > 0)
  const canRedo = useBuilder((s) => s.future.length > 0)
  const layout = useBuilder((s) => s.doc.draft.layout)
  if (readOnly) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div role="toolbar" aria-label="Form tools" className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={() => store.getState().undo()}>
              <Undo2 aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo ({MOD}Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={() => store.getState().redo()}>
              <Redo2 aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo ({MOD}⇧Z)</TooltipContent>
        </Tooltip>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <div role="group" aria-label="Layout" className="hidden items-center gap-0.5 rounded-md bg-muted p-0.5 xl:flex">
          {LAYOUTS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={layout === l}
              onClick={() => layout !== l && store.getState().commit('Change layout', (d) => void (d.draft.layout = l))}
              className={cn(
                'focus-ring press h-7 cursor-pointer rounded-md border px-3 text-label whitespace-nowrap transition-[background-color,border-color,color,scale] duration-(--duration-fast) ease-out',
                layout === l ? 'border-border-ink bg-card text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {SHORT_LAYOUT[l]}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={onInsert} size="sm" className="px-3">
          <Plus aria-hidden />
          Add question
        </Button>
      </div>
    </div>
  )
}

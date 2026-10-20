import { useEffect, useMemo, useState } from 'react'
import { Monitor, RotateCcw, Smartphone } from 'lucide-react'
import { LAYOUT_LABEL } from '@shared/form/definition'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/components/ui/cn'
import { FormRenderer } from '@/respondent/FormRenderer'
import { loadThemeFont } from '@/builder/fonts'
import { useBuilder } from '@/builder/store'

export type Device = 'desktop' | 'mobile'

/** The live renderer on the current draft and theme, in a 390px or full-width frame. */
export function FormPreview({ device, resetKey = 0, className }: { device: Device; resetKey?: number; className?: string }) {
  const draft = useBuilder((s) => s.doc.draft)
  const theme = useBuilder((s) => s.doc.theme)
  const formLabels = useBuilder((s) => s.settings.labels)
  const labels = useMemo(() => ({ ...draft.labels, ...formLabels }), [draft.labels, formLabels])
  useEffect(() => {
    void loadThemeFont(theme.font)
    void loadThemeFont(theme.questionFont)
  }, [theme.font, theme.questionFont])
  return (
    <div
      className={cn(
        'mx-auto h-full overflow-y-auto overscroll-contain [container-type:inline-size]',
        device === 'mobile' ? 'w-[390px] max-w-full rounded-2xl border-8 border-foreground/80' : 'w-full',
        className,
      )}
      data-device={device}
    >
      <FormRenderer key={resetKey} definition={draft} theme={theme} labels={labels} mode="preview" device={device} />
    </div>
  )
}

export function DeviceToggle({ value, onChange }: { value: Device; onChange(d: Device): void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v as Device)} aria-label="Preview size">
      <ToggleGroupItem value="desktop" aria-label="Desktop">
        <Monitor aria-hidden />
        Desktop
      </ToggleGroupItem>
      <ToggleGroupItem value="mobile" aria-label="Mobile">
        <Smartphone aria-hidden />
        Mobile
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function PreviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const [device, setDevice] = useState<Device>('desktop')
  const [resetKey, setResetKey] = useState(0)
  const layout = useBuilder((s) => s.doc.draft.layout)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92svh] w-[min(1200px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 pr-14">
          <div className="grid">
            <DialogTitle className="text-subheading">Preview</DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground">
              {LAYOUT_LABEL[layout]} layout. Answers here are not saved.
            </DialogDescription>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResetKey((k) => k + 1)}>
              <RotateCcw aria-hidden />
              Restart
            </Button>
            <DeviceToggle value={device} onChange={setDevice} />
          </div>
        </div>
        <div className={cn('min-h-0 flex-1 bg-muted', device === 'mobile' && 'p-6')}>
          <FormPreview device={device} resetKey={resetKey} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

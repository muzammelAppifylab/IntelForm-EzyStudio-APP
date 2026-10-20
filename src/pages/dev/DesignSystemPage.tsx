import { Monitor, Moon, Sun } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { DsComponents } from './design-system/DsComponents'
import { FormThemePreview } from './design-system/FormThemePreview'
import { Foundations } from './design-system/Foundations'
import { UiComponents } from './design-system/UiComponents'

const NAV = [
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['shape', 'Shape'],
  ['buttons', 'Buttons'],
  ['inputs', 'Inputs'],
  ['display', 'Display'],
  ['navigation', 'Navigation'],
  ['overlays', 'Overlays'],
  ['table', 'Table'],
  ['ds', 'Form components'],
  ['chart', 'Chart'],
  ['icons', 'Field icons'],
  ['form-theme', 'Form theme'],
] as const

/**
 * Living design system reference at /design-system (development builds only): tokens, type,
 * every ui primitive in its states, every ds component, a chart and a .form-theme preview.
 * Owned by Agent A (design system).
 */
export default function DesignSystemPage() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="min-h-svh bg-background text-foreground">
      <title>Design system</title>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
          <div className="grid">
            <span className="text-subheading text-foreground">IntelForm</span>
            <span className="text-caption text-muted-foreground">Design system reference</span>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={preference}
            onValueChange={(v) => v && setPreference(v as ThemePreference)}
            aria-label="Colour theme"
            className="ml-auto"
          >
            <ToggleGroupItem value="light" aria-label="Light theme">
              <Sun aria-hidden /> <span className="max-sm:sr-only">Light</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark theme">
              <Moon aria-hidden /> <span className="max-sm:sr-only">Dark</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="system" aria-label="System theme">
              <Monitor aria-hidden /> <span className="max-sm:sr-only">System</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <nav aria-label="Sections" className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-full sm:px-0">
            <ul className="flex gap-1 whitespace-nowrap">
              {NAV.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="focus-ring inline-flex h-(--control-sm) items-center rounded-md px-2.5 text-label text-muted-foreground transition-colors duration-(--duration-fast) ease-out hover:bg-accent hover:text-accent-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-16 px-4 py-8 sm:px-8 sm:py-12">
        <div className="grid gap-2">
          <h1 className="text-title text-foreground">Design system</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            Paper and ink (v2.1): an oat paper canvas, ink type and 2px ink edges, periwinkle actions, pine confirmations and
            one persimmon live accent. Every value on this page comes from src/styles/styles.css; components use only its
            semantic tokens.
          </p>
        </div>
        <Foundations />
        <UiComponents />
        <DsComponents />
        <FormThemePreview />
      </main>
    </div>
  )
}

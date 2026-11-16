import { useState, type CSSProperties } from 'react'
import '@fontsource-variable/manrope'
import { themePreset, themeToVars } from '@shared/form/theme'
import { ChoiceGroup, NpsScale, ProgressBar, RatingScale, TextField } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Section } from './parts'

/**
 * A custom preset built from semantic tokens (so it holds in light and dark), to show what the Design tab can change.
 * Real presets come from shared/form/theme.ts via themeToVars().
 */
const CUSTOM_PRESET = {
  '--form-bg': 'var(--info-subtle)',
  '--form-surface': 'var(--card)',
  '--form-question': 'var(--foreground)',
  '--form-answer': 'var(--pine)',
  '--form-button': 'var(--pine)',
  '--form-button-foreground': 'var(--pine-foreground)',
  '--form-progress': 'var(--pine)',
  '--form-font': 'var(--typeface-mono)',
  '--form-question-font': 'var(--typeface-sans)',
  '--form-radius': '0.25rem',
} as CSSProperties

/** B's dark preset with a pill button shape and the large font step, through the real themeToVars(). */
const midnight = themePreset('midnight')!.theme
const MIDNIGHT = themeToVars({ ...midnight, buttonRadius: 'pill', fontSize: 'l' }) as CSSProperties

function Preview({ title, style }: { title: string; style?: CSSProperties }) {
  const [answer, setAnswer] = useState<string | null>('weekly')
  const [nps, setNps] = useState<number | null>(8)
  const [rating, setRating] = useState<number | null>(3)
  return (
    <div className="grid gap-2">
      <span className="text-caption text-muted-foreground">{title}</span>
      {/* .form-theme scopes the --form-* variables; the IntelForm preset is its default. */}
      <div className="form-theme grid gap-6 rounded-xl border border-border p-6 sm:p-8" style={style}>
        <ProgressBar current={2} total={5} label="Question 2 of 5" />
        <div className="grid gap-6 rounded-[min(var(--form-radius),0.75rem)] bg-(--form-surface) p-6">
          <ChoiceGroup
            type="radio"
            legend={<span className="font-(family-name:--form-question-font) text-(--form-question)">How often do you send surveys?</span>}
            options={[
              { value: 'weekly', label: 'Every week' },
              { value: 'monthly', label: 'Every month' },
              { value: 'rarely', label: 'A few times a year' },
            ]}
            value={answer}
            onChange={setAnswer}
          />
          <NpsScale legend="How likely are you to recommend us?" value={nps} onChange={setNps} />
          <RatingScale legend="Rate the onboarding" value={rating} onChange={setRating} />
          <TextField label="Your email" size="lg" type="email" placeholder="name@example.com" />
          <TextField label="Website" size="lg" defaultValue="example" error="Enter a full address like https://example.com" />
          <Button
            size="lg"
            className={cn(
              'w-fit rounded-[var(--form-radius)] bg-(--form-button) font-(family-name:--form-font) text-(--form-button-foreground) hover:bg-(--form-button)/90',
            )}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export function FormThemePreview() {
  return (
    <Section
      id="form-theme"
      title="Respondent form theme"
      intro="A form's Design tab overrides --form-bg, --form-surface, --form-question, --form-answer, --form-button, --form-progress, --form-font, --form-question-font and --form-radius inside .form-theme."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Preview title="IntelForm preset (defaults)" />
        <Preview title="Custom preset (pine colours, mono font, 4px radius)" style={CUSTOM_PRESET} />
        <Preview title="Midnight preset via themeToVars() (dark, pill buttons, large text)" style={MIDNIGHT} />
      </div>
    </Section>
  )
}

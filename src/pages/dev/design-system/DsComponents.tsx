import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { FileText, Inbox, Timer, Users } from 'lucide-react'
import { FIELD_TYPES, FIELD_TYPE_META } from '@shared/form/field-types'
import { FIELD_ICONS } from '@/form-types/icons'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import {
  ChoiceGroup,
  EmptyState,
  NpsScale,
  NpsSummaryBar,
  ProgressBar,
  RatingScale,
  StatCard,
  StatusBadge,
  STATUSES,
  TextField,
} from '@/components/ds'
import { Section, Specimen } from './parts'

const SOURCES = [
  { key: 'direct', label: 'Direct link', value: 412 },
  { key: 'email', label: 'Email', value: 318 },
  { key: 'embed', label: 'Embed', value: 241 },
  { key: 'social', label: 'Social', value: 167 },
  { key: 'qr', label: 'QR code', value: 92 },
  { key: 'other', label: 'Other', value: 54 },
]
const chartConfig = Object.fromEntries(
  SOURCES.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${i + 1})` }]),
) satisfies ChartConfig

export function DsComponents() {
  const [source, setSource] = useState<string | null>('friend')
  const [features, setFeatures] = useState<string[]>(['logic', '__other__'])
  const [otherText, setOtherText] = useState('Offline mode')
  const [nps, setNps] = useState<number | null>(9)
  const [stars, setStars] = useState<number | null>(4)
  const [num, setNum] = useState<number | null>(7)
  const [face, setFace] = useState<number | null>(null)
  const [step, setStep] = useState(3)
  const [email, setEmail] = useState('')

  return (
    <>
      <Section id="ds" title="Form and dashboard components" intro="From src/components/ds. Respondent components use native inputs inside a fieldset, so they work with forms, labels and assistive tech.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen title="StatusBadge" note="The word is always shown; the dot is decoration.">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </Specimen>
          <Specimen title="ProgressBar" note="6px, coral, 320ms width transition (instant under reduced motion)." bodyClassName="grid gap-5">
            <ProgressBar current={step} total={8} showPercent />
            <ProgressBar current={2} total={4} label="Step 2 of 4" labelPosition="bottom" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                Back
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setStep((s) => Math.min(8, s + 1))}>
                Next
              </Button>
            </div>
          </Specimen>
          <Specimen title="ChoiceGroup: single choice" note="Focus an option, then press A, B or C." bodyClassName="block">
            <ChoiceGroup
              type="radio"
              legend="How did you hear about us?"
              required
              options={[
                { value: 'search', label: 'Search engine' },
                { value: 'friend', label: 'A friend or colleague' },
                { value: 'social', label: 'Social media' },
                { value: 'event', label: 'An event (disabled)', disabled: true },
              ]}
              value={source}
              onChange={setSource}
            />
          </Specimen>
          <Specimen title="ChoiceGroup: multiple choice, horizontal, with Other" bodyClassName="block">
            <ChoiceGroup
              type="checkbox"
              legend="Which features do you use?"
              description="Choose all that apply."
              orientation="horizontal"
              options={[
                { value: 'logic', label: 'Logic' },
                { value: 'themes', label: 'Themes' },
                { value: 'webhooks', label: 'Webhooks' },
              ]}
              other={{ text: otherText, onTextChange: setOtherText }}
              value={features}
              onChange={setFeatures}
            />
          </Specimen>
          <Specimen title="ChoiceGroup: error" bodyClassName="block">
            <ChoiceGroup
              type="radio"
              legend="Can we contact you?"
              letterKeys={false}
              orientation="horizontal"
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
              value={null}
              onChange={() => {}}
              error="Choose an answer to continue"
            />
          </Specimen>
          <Specimen title="TextField" bodyClassName="grid gap-5">
            <TextField
              label="Email address"
              required
              type="email"
              placeholder="name@example.com"
              description="Dashboard size (md, 40px)."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField label="Your name" size="lg" placeholder="Jane Doe" description="Respondent size (lg, 48px, answer type)." />
            <TextField label="Website" size="lg" defaultValue="example" error="Enter a full address like https://example.com" />
            <TextField label="Anything else?" multiline size="lg" placeholder="Type your answer" />
          </Specimen>
          <Specimen title="NpsScale" note="Wraps to 0–5 / 6–10 below a 480px container. Never coloured by group." bodyClassName="block">
            <NpsScale legend="How likely are you to recommend us to a friend?" value={nps} onChange={setNps} />
          </Specimen>
          <Specimen title="NpsSummaryBar" bodyClassName="block">
            <NpsSummaryBar detractors={18} passives={27} promoters={55} />
          </Specimen>
          <Specimen title="RatingScale" bodyClassName="grid gap-6">
            <RatingScale legend="Rate your experience" value={stars} onChange={setStars} />
            <RatingScale legend="How easy was setup?" variant="numbers" max={10} value={num} onChange={setNum} lowLabel="Very hard" highLabel="Very easy" />
            <RatingScale legend="How do you feel about the new editor?" variant="emoji" value={face} onChange={setFace} error="Pick a face to continue" />
          </Specimen>
          <div className="grid content-start gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="Responses" value="1,284" icon={Inbox} delta={{ value: '12%', trend: 'up', period: 'vs last 7 days' }} />
              <StatCard label="Completion rate" value="76%" icon={Users} delta={{ value: '3 pts', trend: 'down', period: 'vs last 7 days' }} />
              <StatCard label="Avg. time" value="2m 14s" icon={Timer} delta={{ value: '0%', trend: 'flat' }} />
              <StatCard label="Drop-off" value="24%" delta={{ value: '3 pts', trend: 'up', upIsGood: false, period: 'vs last 7 days' }} />
            </div>
            <EmptyState
              icon={FileText}
              title="No responses yet"
              actions={
                <>
                  <Button>Share form</Button>
                  <Button variant="ghost">Preview</Button>
                </>
              }
            >
              Share your form to start collecting them.
            </EmptyState>
          </div>
        </div>
      </Section>

      <Section id="chart" title="Chart" intro="Series take chart-1 to chart-6 in order, with labelled axes. Sample data.">
        <Specimen title="Responses by source" note="Last 30 days · sample data" bodyClassName="block">
          <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
            <BarChart data={SOURCES} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator nameKey="key" />} />
              <Bar dataKey="value" name="Responses" radius={[6, 6, 0, 0]}>
                {SOURCES.map((s) => (
                  <Cell key={s.key} fill={`var(--color-${s.key})`} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </Specimen>
      </Section>

      <Section id="icons" title="Field type icons" intro="One fixed Lucide icon per field type (src/form-types/icons.ts), 16px in dense UI and 20px elsewhere.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {FIELD_TYPES.map((t) => {
            const Icon = FIELD_ICONS[t]
            return (
              <div key={t} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="truncate text-label text-foreground">{FIELD_TYPE_META[t].label}</span>
              </div>
            )
          })}
        </div>
      </Section>
    </>
  )
}

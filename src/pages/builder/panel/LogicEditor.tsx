import { GitBranch, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { VALUELESS_OPS, type Condition, type ConditionOp, type FormField, type LogicRule } from '@shared/form/definition'
import { lintLogic } from '@shared/form/logic'
import { coreRegistry } from '@shared/form/types/registry'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CONDITION_VALUE_INPUTS } from '@/form-types/settings'
import { FIELD_ICONS } from '@/form-types/icons'
import { Note } from '@/builder/controls'
import { describeRule, OP_MENU_LABEL } from '@/builder/describe'
import { fieldName } from '@/builder/ops'
import { useBuilder, useBuilderStore } from '@/builder/store'
import type { ConditionValueComponent } from '@/builder/type-ui'

const MAX_CONDITIONS = 20
const trigger = 'h-(--control-sm) text-body-sm'

/**
 * Show/hide rule on the selected question (PRD "Logic"): one rule, conditions joined by ALL or
 * ANY, each comparing an earlier question with a value.
 */
export function LogicEditor({ field, index }: { field: FormField; index: number }) {
  const store = useBuilderStore()
  const draft = useBuilder((s) => s.doc.draft)
  const readOnly = useBuilder((s) => s.readOnly)
  const sources = draft.fields.slice(0, index).filter((f) => coreRegistry[f.type].stores && coreRegistry[f.type].operators.length > 0)
  const rule = field.logic
  const issues = lintLogic(draft).filter((i) => i.fieldId === field.id && i.conditionIndex !== undefined)
  const what = field.type === 'section_break' ? 'page' : 'question'

  const setRule = (recipe: (rule: LogicRule) => void, key?: string) =>
    store.getState().updateField(
      field.id,
      (f) => {
        if (f.logic) recipe(f.logic as LogicRule)
      },
      key,
      'Edit rule',
    )

  const newCondition = (src: FormField): Condition => ({ field: src.id, op: coreRegistry[src.type].operators[0] })

  if (!rule) {
    if (!sources.length)
      return (
        <p className="text-body-sm text-muted-foreground">
          Rules use answers to questions above this one. Add a question above it, or move this {what} further down, to add a rule.
        </p>
      )
    return (
      <div className="grid gap-2">
        <p className="text-body-sm text-muted-foreground">This {what} is always shown. Add a rule to show or hide it based on earlier answers.</p>
        {!readOnly && (
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() =>
              store.getState().updateField(
                field.id,
                (f) => void (f.logic = { action: 'show', match: 'all', conditions: [newCondition(sources.at(-1)!)] }),
                undefined,
                'Add rule',
              )
            }
          >
            <GitBranch aria-hidden />
            Add a rule
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <Select value={rule.action} onValueChange={(v) => setRule((r) => void (r.action = v as LogicRule['action']))} disabled={readOnly}>
          <SelectTrigger aria-label="Show or hide" className={`${trigger} w-24`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="show">Show</SelectItem>
            <SelectItem value="hide">Hide</SelectItem>
          </SelectContent>
        </Select>
        <span>this {what} when</span>
        {rule.conditions.length > 1 ? (
          <>
            <Select value={rule.match} onValueChange={(v) => setRule((r) => void (r.match = v as LogicRule['match']))} disabled={readOnly}>
              <SelectTrigger aria-label="Match all or any" className={`${trigger} w-20`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="any">any</SelectItem>
              </SelectContent>
            </Select>
            <span>of these are true:</span>
          </>
        ) : (
          <span>this is true:</span>
        )}
      </div>

      <ol className="grid gap-2" aria-label="Conditions">
        {rule.conditions.map((c, ci) => (
          <ConditionRow
            key={ci}
            n={ci}
            condition={c}
            sources={sources}
            allFields={draft.fields}
            readOnly={readOnly}
            joiner={ci === 0 ? null : rule.match === 'all' ? 'and' : 'or'}
            onChange={(next, key) => setRule((r) => void (r.conditions[ci] = next), key)}
            onRemove={
              rule.conditions.length > 1
                ? () => setRule((r) => void r.conditions.splice(ci, 1))
                : undefined
            }
          />
        ))}
      </ol>

      {issues.map((issue, i) => (
        <Note key={i} tone="warning">
          {issue.message}
        </Note>
      ))}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={rule.conditions.length >= MAX_CONDITIONS}
            onClick={() => setRule((r) => void r.conditions.push(newCondition(sources.at(-1)!)))}
          >
            <Plus aria-hidden />
            Add condition
          </Button>
          <Button variant="ghost" size="sm" onClick={() => store.getState().updateField(field.id, (f) => void delete f.logic, undefined, 'Remove rule')}>
            <Trash2 aria-hidden />
            Remove rule
          </Button>
        </div>
      )}

      <p className="flex items-start gap-1.5 rounded-md bg-info-subtle px-2 py-1.5 text-caption text-info-subtle-foreground">
        <GitBranch className="mt-px size-3.5 shrink-0" aria-hidden />
        {describeRule(draft, rule)}
      </p>
    </div>
  )
}

function ConditionRow({
  n,
  condition,
  sources,
  allFields,
  readOnly,
  joiner,
  onChange,
  onRemove,
}: {
  n: number
  condition: Condition
  sources: FormField[]
  allFields: FormField[]
  readOnly: boolean
  joiner: string | null
  onChange(c: Condition, key?: string): void
  onRemove?: () => void
}) {
  const draft = useBuilder((s) => s.doc.draft)
  const src = sources.find((f) => f.id === condition.field)
  const stray = !src ? allFields.find((f) => f.id === condition.field) : undefined
  const ops = src ? coreRegistry[src.type].operators : []
  const Value = src ? (CONDITION_VALUE_INPUTS[src.type] as ConditionValueComponent | undefined) : undefined
  const needsValue = !VALUELESS_OPS.includes(condition.op)

  return (
    <li className="grid gap-2 rounded-md border border-border bg-background p-2.5">
      <div className="flex items-center gap-2">
        {joiner && <span className="text-overline text-muted-foreground">{joiner}</span>}
        <span className="sr-only">Condition {n + 1}</span>
        {onRemove && !readOnly && (
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Remove condition ${n + 1}`} onClick={onRemove}>
            <X aria-hidden />
          </Button>
        )}
      </div>
      <Select
        value={src ? src.id : undefined}
        onValueChange={(id) => {
          const next = sources.find((f) => f.id === id)
          if (next) onChange({ field: next.id, op: coreRegistry[next.type].operators[0] })
        }}
        disabled={readOnly}
      >
        <SelectTrigger aria-label={`Question for condition ${n + 1}`} className={`${trigger} w-full`}>
          <SelectValue placeholder={stray ? `${fieldName(draft, stray)} (now below, pick again)` : 'Deleted question, pick another'} />
        </SelectTrigger>
        <SelectContent>
          {sources.map((f) => {
            const Icon = FIELD_ICONS[f.type]
            return (
              <SelectItem key={f.id} value={f.id}>
                <Icon aria-hidden />
                <span className="truncate">{fieldName(draft, f)}</span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {src && (
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2">
          <Select
            value={ops.includes(condition.op) ? condition.op : undefined}
            onValueChange={(op) => {
              const nextOp = op as ConditionOp
              const keep = !VALUELESS_OPS.includes(nextOp) && needsValue
              onChange({ field: condition.field, op: nextOp, ...(keep && condition.value !== undefined ? { value: condition.value } : {}) })
            }}
            disabled={readOnly}
          >
            <SelectTrigger aria-label={`Comparison for condition ${n + 1}`} className={`${trigger} w-full`}>
              <SelectValue placeholder="Comparison" />
            </SelectTrigger>
            <SelectContent>
              {ops.map((op) => (
                <SelectItem key={op} value={op}>
                  {OP_MENU_LABEL[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {needsValue && Value ? (
            <Value
              field={src as never}
              op={condition.op}
              value={condition.value}
              label={`Value for condition ${n + 1}`}
              readOnly={readOnly}
              onChange={(value) => {
                const next: Condition = { field: condition.field, op: condition.op }
                if (value !== undefined && value !== '') next.value = value
                onChange(next, `cond:${n}:${condition.field}`)
              }}
            />
          ) : (
            <span />
          )}
        </div>
      )}
      {!src && (
        <p className="flex items-center gap-1.5 text-caption text-warning-subtle-foreground">
          <TriangleAlert className="size-3.5" aria-hidden />
          Pick a question above this one.
        </p>
      )}
    </li>
  )
}

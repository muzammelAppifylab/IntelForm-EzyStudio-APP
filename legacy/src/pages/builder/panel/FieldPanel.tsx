import { useState } from 'react'
import type { FormField } from '@shared/form/definition'
import { FIELD_GROUP_LABEL, FIELD_GROUPS, FIELD_TYPE_META, FIELD_TYPES, type FieldType } from '@shared/form/field-types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Copy, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FIELD_ICONS } from '@/form-types/icons'
import { FIELD_SETTINGS } from '@/form-types/settings'
import { PanelSection, SwitchRow, TextRow } from '@/builder/controls'
import { PipeInput } from '@/builder/pipe/PipeInput'
import { useBuilder, useBuilderStore } from '@/builder/store'
import type { FieldSettingsComponent } from '@/builder/type-ui'
import { LogicEditor } from './LogicEditor'

/** Settings for the selected question (PRD "Common settings" + the type's own + its rule). */
export function FieldPanel({ id }: { id: string }) {
  const store = useBuilderStore()
  const draft = useBuilder((s) => s.doc.draft)
  const readOnly = useBuilder((s) => s.readOnly)
  const index = draft.fields.findIndex((f) => f.id === id)
  const field = draft.fields[index]
  if (!field) return null
  const meta = FIELD_TYPE_META[field.type]
  const isSection = field.type === 'section_break'
  const Settings = FIELD_SETTINGS[field.type] as FieldSettingsComponent
  const update = (recipe: (f: FormField) => void, key?: string, label?: string) => store.getState().updateField(id, recipe as never, key, label)

  const number = draft.fields.slice(0, index + 1).filter((f) => f.type !== 'section_break').length
  const TRIGGER = 'h-full flex-1 rounded-md text-label group-data-[variant=default]/tabs-list:data-[state=active]:bg-card group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground'

  return (
    <Tabs defaultValue="settings" className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="grid gap-5 border-b border-border px-5 pt-6 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="text-overline text-muted-foreground">{isSection ? 'Section break' : `Question ${number}`}</p>
            <h2 className="truncate text-heading-sm">{isSection ? 'Section' : meta.label}</h2>
          </div>
          {!readOnly && (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" aria-label="Duplicate this question" onClick={() => store.getState().duplicate(id)}>
                <Copy aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Delete this question" className="text-destructive hover:text-destructive" onClick={() => store.getState().requestDelete(id)}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          )}
        </div>
        <TabsList className="h-9 w-full rounded-lg p-0.5">
          <TabsTrigger value="settings" className={TRIGGER}>
            Settings
          </TabsTrigger>
          <TabsTrigger value="logic" className={TRIGGER}>
            Logic
            {field.logic && (
              <>
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                <span className="sr-only">(has a rule)</span>
              </>
            )}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="logic" className="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title={isSection ? 'Show or hide this page' : 'Show or hide this question'}>
          <LogicEditor field={field} index={index} />
        </PanelSection>
      </TabsContent>
      <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <TypeSwitcher field={field} readOnly={readOnly} />
        </div>
        <PanelSection title={isSection ? 'Page' : 'Question'}>
          <div className="grid gap-1.5">
            <Label className="text-label" onClick={(e) => (e.currentTarget.nextElementSibling?.querySelector('[contenteditable]') as HTMLElement | null)?.focus()}>
              {isSection ? 'Page title' : 'Label'}
            </Label>
            <PipeInput
              ariaLabel={isSection ? 'Page title' : 'Label'}
              value={field.label}
              beforeIndex={index}
              readOnly={readOnly}
              placeholder={isSection ? 'Section title' : 'Type your question'}
              onChange={(v) => update((f) => void (f.label = v.slice(0, 500)), `label:${id}`, 'Edit label')}
            />
            <p className="text-caption text-muted-foreground">Type @ to show an earlier answer.</p>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-label">Description</Label>
            <PipeInput
              ariaLabel="Description"
              multiline
              value={field.description ?? ''}
              beforeIndex={index}
              readOnly={readOnly}
              placeholder="Optional help text"
              onChange={(v) =>
                update(
                  (f) => {
                    if (v) f.description = v.slice(0, 2000)
                    else delete f.description
                  },
                  `description:${id}`,
                  'Edit description',
                )
              }
            />
          </div>
          {meta.hasPlaceholder && (
            <TextRow
              label="Placeholder"
              value={field.placeholder ?? ''}
              maxLength={200}
              disabled={readOnly}
              placeholder="Type your answer here"
              onChange={(v) =>
                update(
                  (f) => {
                    if (v) f.placeholder = v
                    else delete f.placeholder
                  },
                  `placeholder:${id}`,
                )
              }
            />
          )}
          {!isSection && (
            <SwitchRow
              label="Hide label"
              description="Screen readers still read it."
              checked={!!field.hideLabel}
              disabled={readOnly}
              onCheckedChange={(v) =>
                update((f) => {
                  if (v) f.hideLabel = true
                  else delete f.hideLabel
                })
              }
            />
          )}
        </PanelSection>

        {meta.stores && (
          <PanelSection title="Answer">
            <SwitchRow
              label="Required"
              description="Only while the question is shown."
              checked={field.required}
              disabled={readOnly}
              onCheckedChange={(v) => update((f) => void (f.required = v), undefined, 'Toggle required')}
            />
            {field.required && (
              <TextRow
                label="Message when left empty"
                value={field.requiredError ?? ''}
                maxLength={200}
                disabled={readOnly}
                placeholder="This question is required"
                onChange={(v) =>
                  update(
                    (f) => {
                      if (v) f.requiredError = v
                      else delete f.requiredError
                    },
                    `requiredError:${id}`,
                  )
                }
              />
            )}
          </PanelSection>
        )}

        <PanelSection title={`${meta.label} settings`}>
          <Settings
            field={field}
            readOnly={readOnly}
            onChange={(patch, key) => update((f) => void Object.assign(f.props as object, patch), key, 'Change setting')}
          />
        </PanelSection>

      </TabsContent>
    </Tabs>
  )
}

function TypeSwitcher({ field, readOnly }: { field: FormField; readOnly: boolean }) {
  const store = useBuilderStore()
  const responses = useBuilder((s) => s.meta.responses)
  const [pending, setPending] = useState<FieldType | null>(null)
  const Icon = FIELD_ICONS[field.type]

  function choose(type: FieldType) {
    if (type === field.type) return
    // Old answers belong to the old type: with responses, the question gets a new id.
    if (responses > 0) setPending(type)
    else store.getState().setType(field.id, type, false)
  }

  return (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <Select value={field.type} onValueChange={(v) => choose(v as FieldType)} disabled={readOnly}>
        <SelectTrigger aria-label="Question type" className="h-(--control-sm) flex-1 text-body-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_GROUPS.map((g) => (
            <SelectGroup key={g}>
              <SelectLabel>{FIELD_GROUP_LABEL[g]}</SelectLabel>
              {FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].group === g).map((t) => (
                <SelectItem key={t} value={t}>
                  {FIELD_TYPE_META[t].label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change to {pending ? FIELD_TYPE_META[pending].label : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This form already has {responses.toLocaleString()} {responses === 1 ? 'response' : 'responses'}. The changed question is saved as a new question, so earlier answers stay
              with the old one in Responses. Rules and answer chips that used it move to the new one; check that they still make sense.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {FIELD_TYPE_META[field.type].label}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) store.getState().setType(field.id, pending, true)
                setPending(null)
              }}
            >
              Change type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

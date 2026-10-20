import { FIELD_GROUP_LABEL, FIELD_GROUPS, FIELD_TYPE_META, FIELD_TYPES } from '@shared/form/field-types'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { FIELD_ICONS } from '@/form-types/icons'
import { fieldName } from '@/builder/ops'
import { useBuilder, useBuilderStore } from '@/builder/store'
import { FIELD_KEYWORDS } from '@/builder/palette-search'

/** The `/` menu: search every question type and insert it below the selected question. */
export function InsertMenu({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const store = useBuilderStore()
  const selection = useBuilder((s) => s.selection)
  const draft = useBuilder((s) => s.doc.draft)
  const selected = draft.fields.find((f) => f.id === selection)
  const where = selected ? `below “${fieldName(draft, selected)}”` : selection === 'start' ? 'at the top' : 'at the end'

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Add a question" description={`Adds the question ${where}.`}>
      <CommandInput placeholder={`Add a question ${where}…`} aria-label="Search question types" />
      <CommandList>
        <CommandEmpty>No question type matches.</CommandEmpty>
        {FIELD_GROUPS.map((g) => (
          <CommandGroup key={g} heading={FIELD_GROUP_LABEL[g]}>
            {FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].group === g).map((t) => {
              const Icon = FIELD_ICONS[t]
              return (
                <CommandItem
                  key={t}
                  value={`${FIELD_TYPE_META[t].label} ${FIELD_KEYWORDS[t] ?? ''}`}
                  onSelect={() => {
                    onOpenChange(false)
                    store.getState().insertBelowSelection(t)
                  }}
                >
                  <Icon aria-hidden />
                  {FIELD_TYPE_META[t].label}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

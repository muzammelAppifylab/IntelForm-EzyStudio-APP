import { useState } from 'react'
import { DragDropProvider, DragOverlay } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import type { FieldType } from '@shared/form/field-types'
import { FIELD_TYPE_META } from '@shared/form/field-types'
import { FIELD_ICONS } from '@/form-types/icons'
import { useBuildShortcuts } from '@/builder/lifecycle'
import { useBuilderStore } from '@/builder/store'
import { Canvas, CANVAS_END } from './Canvas'
import { DeleteDialog } from './DeleteDialog'
import { InsertMenu } from './InsertMenu'
import { Palette } from './Palette'
import { SettingsPanel } from '../panel/SettingsPanel'

/** Build tab: palette, canvas, settings (PRD "Build tab: three panes"). */
export function BuildTab() {
  const store = useBuilderStore()
  const [insertOpen, setInsertOpen] = useState(false)
  useBuildShortcuts(store, { openInsert: () => !store.getState().readOnly && setInsertOpen(true) })

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source, target } = event.operation
        const s = store.getState()
        if (!source || s.readOnly) return
        if (source.type === 'palette') {
          const type = (source.data as { fieldType: FieldType }).fieldType
          if (!target) return
          const fields = s.doc.draft.fields
          const at = target.id === CANVAS_END ? undefined : fields.findIndex((f) => f.id === target.id)
          if (at === -1) return
          // The new question's label takes focus (store.autoFocus).
          s.addField(type, at)
          return
        }
        if (isSortable(source) && source.initialIndex !== source.index) {
          s.move(String(source.id), source.index)
        }
      }}
    >
      <div className="grid h-full grid-cols-[256px_minmax(0,1fr)_320px]">
        <Palette />
        <Canvas onInsert={() => setInsertOpen(true)} />
        <SettingsPanel />
      </div>
      <DragOverlay dropAnimation={null} disabled={(source) => source?.type !== 'palette'}>
        {(source) => {
          const type = (source.data as { fieldType?: FieldType } | undefined)?.fieldType
          if (!type) return null
          const Icon = FIELD_ICONS[type]
          return (
            <div className="flex items-center gap-2 rounded-md border-2 border-border-ink bg-card px-3 py-2 text-label text-foreground shadow-pop">
              <Icon className="size-4 text-foreground" aria-hidden />
              {FIELD_TYPE_META[type].label}
            </div>
          )
        }}
      </DragOverlay>
      <InsertMenu open={insertOpen} onOpenChange={setInsertOpen} />
      <DeleteDialog />
    </DragDropProvider>
  )
}

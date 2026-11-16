import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Mention from '@tiptap/extension-mention'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Placeholder, UndoRedo } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import type { SuggestionProps } from '@tiptap/suggestion'
import { FIELD_ICONS } from '@/form-types/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/components/ui/cn'
import { chipLabel, docToText, filterSources, PIPE_NODE, textToDoc, type PipeSource } from './pipe-doc'

export interface PipeEditorProps {
  value: string
  onChange(text: string): void
  /** Answers offered by @ (earlier fields only). */
  sources: PipeSource[]
  /** Every field, so chips for any reference get a readable label. */
  allSources: PipeSource[]
  multiline?: boolean
  ariaLabel: string
  placeholder?: string
  readOnly?: boolean
  /** Classes for the editable text (typography). */
  className?: string
  /** Classes for the frame around it. */
  frameClassName?: string
  onFocus?(): void
  /** Focus the end of the text once the editor is ready. */
  autoFocus?: boolean
}

interface MenuState {
  items: PipeSource[]
  index: number
  rect: DOMRect | null
  command: (item: PipeSource) => void
}

/** The editable element, or null while the view isn't mounted (TipTap throws then). */
function viewDom(editor: ReturnType<typeof useEditor>): HTMLElement | null {
  if (!editor || editor.isDestroyed) return null
  try {
    return editor.view.dom
  } catch {
    return null
  }
}

function menuFrom(p: SuggestionProps): MenuState {
  return { items: p.items as PipeSource[], index: 0, rect: p.clientRect?.() ?? null, command: p.command as unknown as (item: PipeSource) => void }
}

const CHIP =
  'inline-flex items-center rounded-sm bg-accent px-1.5 mx-0.5 text-accent-foreground text-[0.9em] font-medium align-baseline cursor-pointer ring-1 ring-inset ring-border select-none'

/**
 * Text with answer-piping chips (PRD Logic → Answer piping). `@` lists earlier answers; picking
 * one inserts a chip and asks for a fallback. Stored as plain text tokens via pipeToken().
 * Loaded lazily: TipTap is builder-only.
 */
export default function PipeEditor(props: PipeEditorProps) {
  const { value, multiline = false, ariaLabel, placeholder, readOnly, className, frameClassName } = props
  const listboxId = useId()
  const propsRef = useRef(props)
  propsRef.current = props
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef(menu)
  menuRef.current = menu
  const [fallbackAt, setFallbackAt] = useState<number | null>(null)
  const [fallback, setFallback] = useState('')
  const lastEmitted = useRef(value)

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editable: !readOnly,
    content: textToDoc(value, multiline),
    extensions: [
      Document,
      Paragraph,
      Text,
      UndoRedo,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Extension.create({
        name: 'pipeKeys',
        addKeyboardShortcuts(): Record<string, () => boolean> {
          const open = () => !!menuRef.current
          return multiline
            ? {}
            : {
                Enter: () => !open(),
                'Shift-Enter': () => true,
                'Mod-Enter': () => true,
              }
        },
      }),
      Mention.extend({
        name: PIPE_NODE,
        addAttributes() {
          return {
            id: { default: null },
            part: { default: null },
            fallback: { default: null },
          }
        },
      }).configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `@${chipLabel(propsRef.current.allSources, node.attrs.id, node.attrs.part)}`,
        renderHTML: ({ node, options }) => {
          const label = chipLabel(propsRef.current.allSources, node.attrs.id, node.attrs.part)
          const fb = node.attrs.fallback ? ` · or “${node.attrs.fallback}”` : ''
          return [
            'span',
            mergeAttributes(options.HTMLAttributes, {
              'data-pipe': node.attrs.id,
              class: CHIP,
              title: `Shows the answer to ${label}${fb ? `, or “${node.attrs.fallback}” when empty` : ''}. Click to set the fallback.`,
            }),
            `${label}${fb}`,
          ]
        },
        suggestion: {
          char: '@',
          // Only the editor being typed in: a synced copy of the same text must not open a menu.
          shouldShow: ({ editor: ed }) => ed.isFocused,
          items: ({ query }) => filterSources(propsRef.current.sources, query),
          command: ({ editor: ed, range, props: item }) => {
            const s = item as unknown as PipeSource
            ed.chain()
              .focus()
              .insertContentAt(range, [{ type: PIPE_NODE, attrs: { id: s.fieldId, part: s.part ?? null, fallback: null } }])
              .run()
            setFallback('')
            setFallbackAt(range.from)
          },
          render: () => ({
            onStart: (p: SuggestionProps) => setMenu(menuFrom(p)),
            onUpdate: (p: SuggestionProps) => setMenu(menuFrom(p)),
            onKeyDown: ({ event }) => {
              const m = menuRef.current
              if (!m) return false
              const n = m.items.length
              if (event.key === 'ArrowDown' && n) {
                setMenu({ ...m, index: (m.index + 1) % n })
                return true
              }
              if (event.key === 'ArrowUp' && n) {
                setMenu({ ...m, index: (m.index - 1 + n) % n })
                return true
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && n) {
                m.command(m.items[m.index])
                return true
              }
              if (event.key === 'Escape') {
                setMenu(null)
                return false
              }
              return false
            },
            onExit: () => setMenu(null),
          }),
        },
      }),
    ],
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': String(multiline),
        'aria-autocomplete': 'list',
        'aria-haspopup': 'listbox',
        class: cn(
          'min-w-0 outline-none whitespace-pre-wrap break-words',
          '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-field-placeholder [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
          className,
        ),
      },
      transformPastedText: (text) => (multiline ? text : text.replace(/\s*\n\s*/g, ' ')),
      handleClickOn: (_view, pos, node) => {
        if (node.type.name !== PIPE_NODE || propsRef.current.readOnly) return false
        setFallback(String(node.attrs.fallback ?? ''))
        setFallbackAt(pos)
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = docToText(ed.getJSON() as Parameters<typeof docToText>[0])
      if (text === lastEmitted.current) return
      lastEmitted.current = text
      propsRef.current.onChange(text)
    },
    onFocus: () => propsRef.current.onFocus?.(),
  }, [])
  // Created once: everything that changes is read through refs, so typing never resets the view.

  // Outside changes (undo, another panel editing the same text) replace the content.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(textToDoc(value, multiline), { emitUpdate: false })
  }, [editor, value, multiline])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (props.autoFocus && editor && !readOnly) requestAnimationFrame(() => viewDom(editor) && editor.commands.focus('end'))
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Combobox state on the editable element for screen readers.
  useEffect(() => {
    const dom = viewDom(editor)
    if (!dom) return
    dom.setAttribute('aria-expanded', String(!!menu))
    if (menu) {
      dom.setAttribute('aria-controls', listboxId)
      if (menu.items.length) dom.setAttribute('aria-activedescendant', `${listboxId}-${menu.index}`)
      else dom.removeAttribute('aria-activedescendant')
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }
  }, [editor, menu, listboxId])

  function applyFallback() {
    if (!editor || fallbackAt === null) return
    const pos = fallbackAt
    editor
      .chain()
      .command(({ tr }) => {
        const node = tr.doc.nodeAt(pos)
        if (node?.type.name !== PIPE_NODE) return false
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, fallback: fallback.replace(/[{}|]/g, '').trim() || null })
        return true
      })
      .focus(pos + 1)
      .run()
    setFallbackAt(null)
  }

  const fallbackNode = fallbackAt !== null && editor ? editor.state.doc.nodeAt(fallbackAt) : null
  const fallbackLabel = fallbackNode ? chipLabel(props.allSources, fallbackNode.attrs.id, fallbackNode.attrs.part) : ''

  return (
    <Popover open={fallbackAt !== null} onOpenChange={(o) => !o && setFallbackAt(null)}>
      <PopoverAnchor asChild>
        <div className={frameClassName} onClick={() => viewDom(editor) && !editor?.isFocused && editor?.commands.focus('end')}>
          <EditorContent editor={editor} />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="grid w-72 gap-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            applyFallback()
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-label">Fallback text</span>
            <span className="text-caption text-muted-foreground">
              Shown instead of {fallbackLabel || 'the answer'} when it is empty. Leave blank to show nothing.
            </span>
            <Input autoFocus value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="e.g. there" maxLength={60} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => (setFallbackAt(null), editor?.commands.focus())}>
              Skip
            </Button>
            <Button type="submit" size="sm">
              Save fallback
            </Button>
          </div>
        </form>
      </PopoverContent>
      {menu &&
        createPortal(
          <div
            className="fixed z-50 max-h-72 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-pop"
            style={{ top: (menu.rect?.bottom ?? 0) + 6, left: menu.rect?.left ?? 0 }}
          >
            <p className="px-2 pt-1 pb-1.5 text-overline text-muted-foreground">Insert an earlier answer</p>
            <ul id={listboxId} role="listbox" aria-label="Earlier answers">
              {menu.items.length === 0 && (
                <li role="presentation" className="px-2 py-1.5 text-body-sm text-muted-foreground">
                  {props.sources.length ? 'No answers match' : 'No earlier questions to show answers from'}
                </li>
              )}
              {menu.items.map((item, i) => {
                const Icon = FIELD_ICONS[item.type]
                return (
                  <li
                    key={`${item.fieldId}.${item.part ?? ''}`}
                    id={`${listboxId}-${i}`}
                    role="option"
                    aria-selected={i === menu.index}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body-sm',
                      i === menu.index && 'bg-accent text-accent-foreground',
                      item.part && 'pl-7',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      menu.command(item)
                    }}
                    onMouseEnter={() => setMenu({ ...menu, index: i })}
                  >
                    {!item.part && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="truncate">{item.label}</span>
                  </li>
                )
              })}
            </ul>
          </div>,
          document.body,
        )}
    </Popover>
  )
}

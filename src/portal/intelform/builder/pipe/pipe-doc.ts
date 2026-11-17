import { coreRegistry } from '../../../../lib/intelform/form/types/registry'
import { PIPE_RE, pipeToken } from '../../../../lib/intelform/form/logic'
import type { FormDefinition, FormField } from '../../../../lib/intelform/form/definition'
import { fieldName } from '../ops'

/**
 * Converts between stored text ("Thanks, {f_8k2m.first|there}!") and the TipTap document the
 * piping editor shows (text + "pipe" chip nodes). Pure, so it is unit-tested without a DOM.
 */

export interface PipeSource {
  fieldId: string
  /** Undefined for the whole answer; "first", "city"… for a part. */
  part?: string
  label: string
  type: FormField['type']
}

export interface JSONNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  content?: JSONNode[]
}

export const PIPE_NODE = 'pipe'

const PART_LABEL: Record<string, string> = {
  first: 'first name',
  last: 'last name',
  street: 'street',
  line2: 'address line 2',
  city: 'city',
  state: 'state',
  postal: 'postal code',
  country: 'country',
  code: 'code',
}

/** Answers that can be piped into a text: storing fields above `beforeIndex` (all when undefined). */
export function pipeSources(def: FormDefinition, beforeIndex?: number): PipeSource[] {
  const fields = beforeIndex === undefined ? def.fields : def.fields.slice(0, Math.max(0, beforeIndex))
  const out: PipeSource[] = []
  for (const f of fields) {
    const core = coreRegistry[f.type]
    if (!core.stores || f.type === 'signature') continue
    const name = fieldName(def, f)
    out.push({ fieldId: f.id, label: name, type: f.type })
    for (const part of core.pipeParts(f)) out.push({ fieldId: f.id, part, label: `${name}: ${PART_LABEL[part] ?? part}`, type: f.type })
  }
  return out
}

export function chipLabel(sources: readonly PipeSource[], fieldId: string, part?: string | null): string {
  const s = sources.find((x) => x.fieldId === fieldId && (x.part ?? null) === (part ?? null))
  return s?.label ?? sources.find((x) => x.fieldId === fieldId)?.label ?? 'Deleted answer'
}

function lineToNodes(line: string): JSONNode[] {
  const nodes: JSONNode[] = []
  let last = 0
  for (const m of line.matchAll(PIPE_RE)) {
    if (m.index > last) nodes.push({ type: 'text', text: line.slice(last, m.index) })
    nodes.push({ type: PIPE_NODE, attrs: { id: m[1], part: m[2] ?? null, fallback: m[3] ?? null } })
    last = m.index + m[0].length
  }
  if (last < line.length) nodes.push({ type: 'text', text: line.slice(last) })
  return nodes
}

export function textToDoc(text: string, multiline: boolean): JSONNode {
  const lines = multiline ? text.split('\n') : [text.replace(/\n/g, ' ')]
  return {
    type: 'doc',
    content: lines.map((line) => {
      const content = lineToNodes(line)
      return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
    }),
  }
}

/** Filter for the @ menu: matches the label words, case-insensitive. */
export function filterSources(sources: readonly PipeSource[], query: string, limit = 30): PipeSource[] {
  const q = query.trim().toLowerCase()
  const list = q ? sources.filter((s) => s.label.toLowerCase().includes(q)) : sources
  return list.slice(0, limit)
}

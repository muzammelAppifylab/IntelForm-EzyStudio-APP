# Research: the form builder

Checked 2026-10-19. Versions and licences come from `npm view` on that date. Feeds [PLAN.md](../PLAN.md) phases 3–4.

## Decisions

| # | Question | Choice (version, licence) | Why | Runner-up |
|---|---|---|---|---|
| 1 | Drag and drop | **@dnd-kit/react 0.5.1 + @dnd-kit/helpers 0.5.1** (MIT, released 2026-10-15) | Supports React 19. The Accessibility plugin is on by default (ARIA, screen-reader instructions, live announcements), pointer and keyboard sensors are automatic, and the sortable plugin covers canvas, options and featured-forms reorder. Actively released. | **@atlaskit/pragmatic-drag-and-drop 4.0.0** (Apache-2.0): smallest and fast, but no keyboard dragging. The old `@dnd-kit/core` 6.3.1 hasn't had a release since 2024-12, so it's out. |
| 2 | Builder state | **zustand 5.0.15 + immer 11.1.21** (MIT), with a small hand-written snapshot history | Autosave, shortcuts and presence can subscribe without re-rendering, and each component selects only its slice. Immutable snapshots share structure, so 100 undo steps stay cheap. | **zundo 2.3.0** (MIT): no release since 2024-11, so vendor it if used. |
| 3 | Piping chips (`@` in labels) | **TipTap 3.32.0** (`@tiptap/core`, `/pm`, `/extension-mention`, `/suggestion`; MIT) with only Document, Paragraph, Text and Mention, lazy-loaded in the builder chunk | Real atomic chips that show "First name" while storage keeps `{f_abc.first}`. ProseMirror gets caret, IME and paste right. Heavy (roughly 70–90 KB gz), but builder-only: the respondent renderer interpolates tokens as plain strings. | Lexical 0.52.0 (more work for mention menus); a custom contenteditable (IME, undo and caret bugs); plain text with a highlight overlay (can't show labels instead of ids). |
| 4 | Field-type registry | **Split by environment**: `shared/form/types/<type>/core.ts` (pure TS + zod) and `src/form-types/<type>/` (React) | The server imports only `shared/`. A lint rule stops `react` or `src/` imports inside `shared/`. | One folder per type with `index.server.ts` / `index.client.ts`, which makes it easier to leak React into the server. |
| 5 | Logic engine | Pure functions in `shared/form/logic.ts`, tested with Vitest + **fast-check 4.10.2** (MIT) | The same code runs in the browser and on the server. One forward pass is enough, because rules may only reference earlier fields. | A JSON-logic library: unnecessary, and a looser contract. |
| 6 | Theme | CSS variables on the form root, mapped to the shadcn tokens. Self-hosted **@fontsource-variable/** fonts (OFL-1.1). Hand-written **WCAG 2 contrast ratio** check. | Self-hosting keeps forms private (no Google IP leak). The PRD asks for WCAG AA. APCA was dropped from the WCAG 3 draft, and `apca-w3` has a restrictive licence. | colorjs.io 0.7.1 (MIT), if colour parsing gets complex. |
| 7 | Preview | **Same document**: the real renderer inside a scoped root using CSS container queries. Mobile preview is a 390 px container. | Instant live updates, no style-injection or portal problems, normal focus and a11y. Radix portals take `container={formRoot}`. | A same-origin iframe route fed the draft by `postMessage`. Switch to this if the renderer needs viewport units. |

## Field-type registry interface

```ts
// shared/form/types/registry.ts: no React, imported by the server
export interface FieldTypeCore<P extends z.ZodType = z.ZodType, A extends z.ZodType = z.ZodType> {
  type: FieldType
  group: FieldGroup
  stores: boolean                               // section_break = false
  hasPlaceholder: boolean
  props: P                                      // per-type settings schema (replaces z.record)
  defaultProps: () => z.infer<P>
  /** Answer validator built from the field: required/min/max/email/E.164 etc. */
  answer: (field: FormField & { props: z.infer<P> }) => A
  isEmpty: (v: z.infer<A> | undefined) => boolean
  operators: readonly ConditionOp[]             // PRD Logic table
  evaluate: (op: ConditionOp, answer: z.infer<A> | undefined, value: unknown) => boolean
  pipe?: Record<string, (v: z.infer<A>) => string> & { default: (v: z.infer<A>) => string } // e.g. name.first
  csv: (v: z.infer<A> | undefined, field: FormField) => string | string[] // array = several columns
  /** On type change: keep label/description/required, map what survives. */
  migrateProps?: (from: FieldType, old: Record<string, unknown>) => Partial<z.infer<P>>
}

// src/form-types/registry.tsx: the React half
export interface FieldTypeUI<T extends FieldTypeCore = FieldTypeCore> {
  core: T
  icon: LucideIcon
  Settings: React.FC<{ field: FieldOf<T>; onChange: (p: Partial<PropsOf<T>>) => void }>
  Renderer: React.FC<{ field: FieldOf<T>; value: AnswerOf<T> | undefined; onChange(v: AnswerOf<T>): void;
                       error?: string; mode: Layout; autoAdvance?: () => void }>
  CanvasPreview?: React.FC<{ field: FieldOf<T> }>   // defaults to a disabled Renderer
  SummaryCard: React.FC<{ field: FieldOf<T>; data: SummaryData }>
  ConditionValueInput: React.FC<{ field: FieldOf<T>; op: ConditionOp; value: unknown; onChange(v: unknown): void }>
}
```

```
shared/form/types/<type>/core.ts      props schema, answer(), operators, csv
shared/form/types/registry.ts         coreRegistry: Record<FieldType, FieldTypeCore>
shared/form/types/common.ts           textOps, numberOps, choiceOps helpers
src/form-types/<type>/                Settings, Renderer, SummaryCard, ConditionValue
src/form-types/registry.tsx           uiRegistry
```

`definition.ts` then builds `field` as `z.discriminatedUnion('type', …)` from `coreRegistry`. Submit validation is `z.object(visible fields → core.answer(field))`, shared by both sides.

## Logic engine

```ts
// shared/form/logic.ts
export type Answers = Record<string, unknown>
export interface Visibility { fields: Set<string>; pages: string[][] } // visible field ids; page → field ids

/** Builder/publish checks: references to later, missing, self or section-break fields; operator valid for source type; option ids exist. */
export function lintLogic(def: FormDefinition): LogicIssue[]
/** One forward pass. A hidden source counts as empty. A hidden section break hides every field up to the next break. */
export function computeVisibility(def: FormDefinition, answers: Answers): Visibility
export function evaluateRule(rule: LogicRule, def: FormDefinition, answers: Answers, visible: Set<string>): boolean
/** Drop answers for hidden, non-storing or unknown fields. */
export function pruneAnswers(def: FormDefinition, answers: Answers): Answers
/** Server: re-run visibility, reject hidden-field answers, required only while visible, per-type zod. */
export function validateSubmission(def: FormDefinition, raw: Answers):
  { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> }
/** Builder warnings */
export function dependentsOf(def: FormDefinition, fieldId: string): { fieldId: string }[]
export function orderViolations(def: FormDefinition): { target: string; source: string }[]
/** Piping: {f_x}, {f_x.first}, {f_x.first|there} (fallback word after |) */
export const PIPE_RE = /\{(f_[a-z0-9]{4,12})(?:\.([a-z]+))?(?:\|([^{}]*))?\}/g
export function interpolate(text: string, def: FormDefinition, answers: Answers): string
```

- **No cycles possible.** "Source index < target index" is checked in the builder and enforced on save and publish, so no graph search is needed.
- **Empty pages are skipped.** A page with no visible fields is skipped in navigation.
- **Empty answers never match.** Each type's `isEmpty` decides emptiness; comparisons against an empty answer return false. ISO dates and HH:mm times compare as strings.
- **Tests.**
  - Table-driven cases for every type × operator.
  - fast-check properties over random forward-only definitions:
    - pruning doesn't change visibility;
    - prune is idempotent;
    - no hidden id survives prune;
    - a pruned submission never fails on visibility.
  - Golden fixtures from the PRD example, also run through the real submit route.

## State, autosave and undo

- **Store.** zustand + immer holding `{ doc, theme, selection, history: { past, future }, save: { status, revision } }`.
- **Undo history.**
  - Every edit goes through `commit(label, recipe, coalesceKey?)`. It pushes the previous `doc` (cap 100) and clears `future`.
  - Typing in one label within 800 ms replaces the last entry instead of adding one.
  - Selection and UI state stay out of history.
- **Shortcuts.** Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Delete, Ctrl/Cmd+D and the arrow keys. They are ignored while focus is in an input or the TipTap editor, which has its own undo.
- **Autosave.**
  - Fires 1000 ms after the last change.
  - Single-flight: changes made during a save trigger one more save when it returns.
  - Sends `PATCH /api/forms/:id { draft, theme }` with `If-Match: "<revision>"`.
  - Status shows Saving… / Saved / Offline. Retries back off 2, 4, 8 … 30 s.
  - Flushes with `fetch(…, { keepalive: true })` on `pagehide`; `beforeunload` is used only while there are unsaved changes.
- **Conflicts (PRD: last save wins).**
  - Add `forms.revision` and `forms.updated_by`.
  - The server always writes and returns whether it overwrote someone else's revision.
  - If it did, the client shows "Sam also edited this form. Your version replaced theirs." On focus, a newer revision from someone else shows "Newer version available. Reload."
- **Presence (no websockets).**
  - `POST /api/forms/:id/presence` every 20 s while the tab is visible, plus a keepalive `DELETE` on pagehide.
  - The server keeps who was seen in the last 45 s. Anyone else shows the "someone else is editing" banner.
- **Theme variables.** `themeToVars(theme)` returns `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--ring`, `--radius`, `--font-sans`, `--font-scale`, `--bg-image` and `--bg-overlay`, applied on `<div data-form-root>`.
- **Contrast check.**
  - Uses relative luminance with ratio `(L1+0.05)/(L2+0.05)`.
  - Warns below 4.5 for normal text and below 3 for large text and controls.
  - For image backgrounds, it checks against the overlay colour and says so in the UI.
- **Fonts.**
  - 12 variable fonts: Inter, DM Sans, Work Sans, Nunito, Montserrat, Source Sans 3, Manrope, Plus Jakarta Sans, Space Grotesk, Playfair Display, Lora, Fraunces.
  - Each is a lazy CSS import, so only the chosen one loads.
  - `/f/:slug` preloads that one font's latin woff2.
- **Presets.** 8 presets, 4 light and 4 dark. A unit test checks that every preset passes the contrast check.

## Risks

1. **@dnd-kit/react is 0.x.** Pin the exact version, wrap it in our own thin `Sortable`, and test keyboard reordering with a screen reader. WCAG 2.5.7 needs a non-drag alternative, so add "Move up / Move down" to each field's menu.
2. **TipTap is large.** Keep it builder-only and lazy. Single-line labels must disable Enter. The mention popup needs `role="listbox"` and `aria-activedescendant`.
3. **Same-document preview** breaks if the renderer uses `vh`, `position: fixed` or viewport `@media`. Use container units, or switch to the iframe preview.
4. **Stale clients.** Old clients on an earlier published version could be rejected. Validate against the `form_version_id` the client rendered.
5. **In-memory presence** fails across several server instances (same caveat as rate limiting).

Sources: [dnd kit changelog](https://dndkit.com/changelog) · [dnd kit Accessibility plugin](https://dndkit.com/extend/plugins/accessibility) · [Pragmatic DnD a11y guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines/) · [WCAG 2.2 SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) · [TipTap Mention](https://tiptap.dev/docs/editor/extensions/nodes/mention) · [WCAG 3 draft, March 2026](https://www.w3.org/WAI/news/2026-03-03/wcag3)

# IntelForm: working notes

Read `README.md` first. The spec is `../IntelForm-Research/01-PRD/IntelForm-PRD.md`; the build order is `../IntelForm-Research/04-Next-Steps/build-plan.md`.

## Rules

- **Design system (IntelForm design system v2.1 "paper & ink", stable).** `docs/DESIGN.md` is the design rulebook for all UI work; record any change to it in `docs/DESIGN-CHANGELOG.md`. Use only the semantic tokens from `src/styles/styles.css` (`bg-card`, `text-muted-foreground`, `border-input`, `border-border-ink`, `bg-pine`, `bg-option-selected`, `text-link`…); `tokens.json` holds the same values. No literal colours, fonts, radii or shadows. Type uses the classes `text-wordmark` (front page footer only), `text-heading`, `text-heading-sm`, `text-subheading`, `text-body`, `text-body-sm`, `text-label`, `text-caption`, `text-overline`, `text-metric`, `text-question`, `text-question-xl`, `text-answer`; titles and big numbers are Instrument Serif 400 (never bold), everything else Figtree.
  - Buttons: primary `bg-primary` + 2px `border-primary-border`, one per view; secondary `bg-secondary` with the same ink edge; `rounded-md`.
  - Cards and panels: `bg-card`, 1px border, `rounded-lg`, no shadow. `shadow-pop` only on menus, popovers, dialogs and the dragged field. No gradients.
  - Inputs: `rounded-md`, 1px `border-input`, 16px text, 2px focus ring.
  - Selected states (active nav, selected option, active tab): periwinkle fill + 2px `border-ink`.
  - Badges: Live `bg-pine text-pine-foreground`, Draft paper with a 2px ink edge, Closed `bg-muted`.
  - `primary` is a pale fill: never use it for text or outlines (links are `text-link`).
  - Persimmon (`highlight`) at most once per screen, for a live signal only.
  - Motion: tokens from `src/styles/motion.css` only (`press`, `press-tile`, `animate-pop-in`, `animate-fade-up`, `animate-fade-in`); durations `duration-(--duration-fast|base|slow)` with `ease-out`. Every interactive control gets hover, press, focus-visible and disabled states.
  - Loading is `Spinner`, ranges are `Slider`, disclosure is `Collapsible` (all in `components/ui`); don't hand-roll them.
- **Copy.** Sentence case, plain verbs on buttons, short past-tense toasts ("Link copied"), errors that say how to fix it. No emoji.
- **Shared validation.** Request bodies are zod schemas in `shared/`, used by the browser (`useFormErrors().validate`) and the server (`readBody`). The server is the source of truth.
- **Roles.** Check permissions on every route with `requirePermission(...)` from `shared/roles.ts`; the client uses `useCan(...)` only to hide controls.
- **SQL.** Only the postgres.js tagged template (`sql\`... ${value}\``). Schema changes go in a new numbered file in `server/db/migrations/`; never edit an applied migration.
- **Imports.** `server/` and `shared/` use relative imports (they run under plain tsx). `src/` uses `@/` and `@shared/`.
- **Placeholders.** `components/common/Placeholder` marks screens a later milestone builds. Remove each when its screen lands.

## Check before finishing

`npm run typecheck && npm run lint && npm test && npm run build`

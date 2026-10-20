# IntelForm design system: changelog

The rulebook is [DESIGN.md](DESIGN.md). Tokens live in `src/styles/styles.css` (with `tokens.json` in DTCG format), motion in `src/styles/motion.css`, components in `src/components/ui` and `src/components/ds`. The living reference is `/design-system` in development builds.

Versioning: a major version changes the look (palette, type, shape); a minor version adds tokens, components or states without changing existing values; a patch fixes a bug in a component or a doc.

## 2.1 (stable), 20 Oct 2026

The first stable release. From here, changes to existing token values or component looks need a new version and an entry here.

**Added**
- Motion and interaction layer, `src/styles/motion.css`, shared by the dashboard and the public form:
  - `press` and `press-tile` utilities: controls sink to 97% and tiles to 98% while held.
  - `animate-pop-in` for selection marks, `animate-fade-up` and `animate-fade-in` for content that appears, and `animate-live-ping` for the Live dot.
- Press feedback on Button, Toggle, Tabs, Checkbox, Radio, Switch and every option, NPS and rating tile.
- Hover outlines on Input, Textarea, Select, Checkbox and Radio. Menu, select and command items fade their highlight. The Select chevron flips while open.
- Pop-in on checkbox marks, radio dots, the selected tile's check icon and the selected rating star or face. Fade-up on field errors, the Other input and empty states. Fade-in on tab panels.
- New components:
  - `Spinner`, which replaces hand-built loader icons in 13 files.
  - `Slider`, which replaces the native range input in the Design tab.
  - `Collapsible` with `CollapsibleChevron`, which replaces the `<details>` block in email settings.
- `KEY_SELECTED` in `components/ds/tokens.ts`, the selected key badge and consent checkbox colours.
- `motion_and_interaction`, `component_inventory` and an `interaction-states` quality-bar item in DESIGN.md.
- A `NOTICE` file listing the third-party libraries and fonts and their licences.

**Fixed**
- The selected A/B/C key badge, consent checkbox and picture-choice badge used `primary-foreground` text on a `--form-answer` fill. Inside a form theme both are ink, so the letter or check disappeared, and on the dashboard the badge melted into the periwinkle tile. They now use `KEY_SELECTED`.
- The rating star hover scale never animated: its transition listed `transform`, but Tailwind v4 `scale-*` sets the `scale` property.

**Changed**
- Version labels now agree: `styles.css`, `CLAUDE.md` and `MIGRATION.md` already said 2.1, while `DESIGN.md` and `tokens.json` still said 2.

## 2.0 "paper & ink"

Replaced the v1 look. `IntelForm-Research/03-Design-System/MIGRATION.md` has the full token mapping.

- Oat paper canvas, ink text and 2px ink edges, periwinkle primary, pine confirmations and one persimmon live accent.
- Instrument Serif 400 for headings and Figtree for the UI, replacing Space Grotesk and Inter.
- Shadowless cards. `shadow-pop` is kept for menus, popovers, dialogs and the dragged field only.
- Radius scale 8 / 12 / 20 / 32 / 48px.
- 80 contrast checks (40 pairings in light and dark), all passing.

## 1.0, 19 Oct 2026 (superseded)

Built from a review of the "Lilac Carnival" export: a violet primary with coral highlights, Space Grotesk and Inter, and fixed dark mode and contrast. Its files were removed on 2026-10-20. Do not build from it.

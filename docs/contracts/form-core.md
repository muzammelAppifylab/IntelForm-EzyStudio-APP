# Contract: form core (`shared/form/`)

Built by agent B, with 701 tests passing (`npx vitest run shared`). It is pure TypeScript and runs in both the browser and Node. Read the source for details; this is the map.

## definition.ts
- **Schema.**
  - `formDefinition` / `FormDefinition`. `field` is a discriminated union on `type`, with props from the registry; every props key has a default.
  - `FormField`, `FieldOf<T>`, `PropsOf<T>`.
  - The start screen has `imageAlt`; the end screen has `button: { label, url }`.
  - `LAYOUTS`, `Layout`, `LAYOUT_LABEL`.
- **Constructors.** `blankDefinition()`, and `newField(type, init?)`, which gives default props and a fresh id.
- **Type change.** `changeFieldType(field, type)` keeps id, label, description, required, required error, hide label, logic and compatible props.
- **Pages.** `fieldsByPage(def)` returns `{ section, fields }[]`, split at section breaks. A section break's page title and description are its `label` and `description`.
- **Logic and ids** (from `base.ts`):
  - `CONDITION_OPS`, `VALUELESS_OPS`, `condition`, `logicRule`;
  - `newFieldId()` (`f_` + 8 characters), `newOptionId()` (`o_` + 6);
  - `OTHER_OPTION_ID = 'o_other'`.

## types/registry.ts
- `coreRegistry: Record<FieldType, FieldTypeCore>` and `typedRegistry`. Each type has:
  - props: `props`, `defaultProps()`, `migrateProps`;
  - answers: `answer(field, ctx?)`, `isEmpty`;
  - logic: `operators`, `evaluate`;
  - piping: `pipeParts(field)`, `pipe(v, part, field)`;
  - CSV: `csvColumns`, `csv`.
- **Server-only validators.** `configureValidators({ phone, isFreeEmailDomain })`. The server wires these at boot:
  ```ts
  import { isValidPhoneNumber } from 'libphonenumber-js/max'
  import freeDomains from 'free-email-domains'
  const free = new Set(freeDomains)
  configureValidators({ phone: (e164) => isValidPhoneNumber(e164), isFreeEmailDomain: (d) => free.has(d) })
  ```
- **Helpers:**
  - countries: `COUNTRY_CODES`, `countryName`, `isCountryCode`;
  - patterns: `ADDRESS_LINES`, `E164_RE`, `EMAIL_RE`;
  - dates and times: `DATE_FORMATS`, `formatDate`, `formatTime`, `isIsoDate`, `isTime`;
  - NPS: `npsCategory`;
  - signatures: `isSignatureDataUrl`, `signatureBytes`, `SIGNATURE_DATA_URL_MAX`;
  - choices: `isChoiceAnswer`.

## Answer encodings
| Type | Value |
|---|---|
| email | trimmed, lowercased string |
| short_text, long_text | trimmed string |
| url | string; "acme.com" becomes "https://acme.com" |
| phone | E.164 |
| name | string, or `{ first, last }` when `props.split` |
| address | `{ street?, line2?, city?, state?, postal?, country? }` (enabled lines only) |
| country | ISO alpha-2, upper case |
| number | number |
| date / time | `"YYYY-MM-DD"` / `"HH:mm"` |
| single_choice, dropdown | `{ option }` or `{ option: 'o_other', other }` |
| multiple_choice, picture_choice | array of those objects |
| yes_no | boolean |
| rating / nps | integer |
| signature | `{ url }`. The browser sends a PNG data URL; the server uploads it (`storeBuffer(signatureBytes(url), 'image/png', …)`) and stores the URL |
| consent | `{ accepted: true, at, text, version? }`. The browser sends `{ accepted: true, at }` |
| section_break | nothing |

## logic.ts
- **Visibility.** `computeVisibility(def, answers)` returns `{ fields: Set, pages: string[][], pageSections }`.
- **Rules and pruning.** `evaluateRule`; `pruneAnswers`.
- **Submission.** `validateSubmission(def, raw, { labels?, context?, hidden?: 'reject' | 'drop' })` returns `{ ok, answers }` or `{ ok: false, errors }`, keyed by field id.
  - The browser passes `context: { dayTolerance: 0 }`.
  - The server passes `context: { now, formVersion }`.
- **Paged validation.** `validatePage(def, answers, ids)` and `validateField` handle Next and Submit in the browser.
- **Lint.** `lintLogic(def)` returns the issues that block publish, as `{ code, message }`.
- **Dependencies.** `dependentsOf(def, id)` returns `{ fieldId, via: 'logic' | 'pipe' }`; the id can also be `startScreen` / `endScreen`. Also `orderViolations`.
- **Piping.**
  - `PIPE_RE`, `parsePipes`, `pipeToken`.
  - `interpolate(text, def, answers)` handles `{f_x}`, `{f_x.first}` and `{f_x.first|fallback}`.

## theme.ts
- **Schema.** `formTheme` / `FormTheme` (optional `questionFont`, logo `alt`); `THEME_FONTS`.
- **Presets.** `THEME_PRESETS` (intelform, linen, apricot, gazette, midnight, evergreen, ember, harbor); `defaultTheme()`, `themePreset(id)`.
- **CSS.** `themeToVars(theme)` returns custom properties for inline style on the `.form-theme` root:
  - form variables: `--form-*`;
  - the matching design-system tokens: `--primary`, `--option-*`, `--field`…;
  - `--typeface-*`, `--form-font-scale`, `--form-bg-image`, `--form-bg-overlay`, `--form-align`, `--form-color-scheme`.
- **Fonts.** `fontPackage(font)` names the @fontsource-variable package to lazy-load the CSS from.
- **Contrast.** `contrastRatio`, `themeContrastIssues`.

## labels.ts, safe-url.ts, csv.ts
- **Labels.**
  - `SYSTEM_LABELS` (about 75 keys); `resolveLabels(overrides)`.
  - `formatLabel(template, { n, total })`.
  - `errorMessage(code, labels)`, for example `"minChars:5"`.
- **URLs.** `safeUrl` (zod, http(s) only) and `isSafeUrl`.
- **CSV.** `csvHeaders(field)`, `answerToCsv(field, value)`, `csvHeadersFor`, `csvRowFor`. Cells are plain text; escaping and the BOM are added in `server/lib/csv.ts`.

## Bundle notes (final)
- The registry and base schemas (`types/*`, `base.ts`) use **zod/mini**. `formDefinition`, `formTheme` and `safeUrl` stay classic zod for the server and builder.
- The respondent imports only zod-free or mini paths:
  - `theme-core.ts`: presets, `themeToVars`, `defaultTheme`, colour maths;
  - `safe-url-core.ts`: `isSafeUrl`, `safeUrlMini`;
  - `labels.ts`, `logic.ts`.
- The respondent uses plain `clsx` (`src/respondent/classes.ts`), never the tailwind-merge `cn`.
- The form page is built on its own (`BUILD_TARGET=form vite build`): 108.5 KB gz initial JS.
- `FormRenderer` takes an optional `initialAnswers`. A failed `SubmitResult` may carry an `action`, e.g. reload after a 409 `version_unknown`.

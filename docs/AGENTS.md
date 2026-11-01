# Parallel build: ownership and rules

Several agents build IntelForm at the same time in this one working tree. These rules keep them from colliding. Read this file, `CLAUDE.md`, `README.md`, the PRD (`../IntelForm-Research/01-PRD/IntelForm-PRD.md`) and the research files in `docs/research/` that your brief names.

## Rules

1. **Only edit files you own** (table below). You may create new files only inside your own paths. If you need a change in someone else's file, don't make it: list it under "Requests for other owners" in your final report.
2. **Never run `npm install` / `npm uninstall` or edit `package.json`.** All planned packages are already installed (`package.json`). If you truly need another one, report it.
3. **Never run `npm run dev`, and never kill processes by pattern** (`pkill -f vite`, `pkill node`): other agents' servers would die. Start your own servers on your own ports and stop them by PID.
4. **Database.** Use your own database: `postgres://intelform:intelform@localhost:5433/intelform_<letter>` (already created). Apply migrations with `DATABASE_URL=… npm run db:migrate`. Migrations are append-only: never edit a migration file another agent owns, or one that is already applied anywhere. Use only your own migration number.
5. **Servers for manual or browser testing** (letter → ports in the table):
   ```bash
   DATABASE_URL=postgres://intelform:intelform@localhost:5433/intelform_x APP_URL=http://localhost:518N API_PORT=879N npx tsx --env-file=.env server/index.ts &
   API_PORT=879N npx vite --port 518N --strictPort &
   ```
   Playwright and headless Chrome are available (`@playwright/test` is installed; use `channel: 'chrome'` or the cached chromium). Put screenshots and scratch scripts in `/private/tmp/…/scratchpad` or `test-results/`, never in `src/`.
6. **Type-check with `npx tsc -b`.** Fix every error in your own files. Other agents' files may be mid-edit: ignore their errors, but mention them if they block you.
7. **Tests.** Put them next to your code (`*.test.ts`), or in `server/test/` (platform), or `e2e/<area>.spec.ts` (yours only). Run them with `npx vitest run <your paths>`.
8. **No git commands.** No commits.
9. **Follow the house rules in `CLAUDE.md`:** design-system tokens only, sentence-case copy, shared zod schemas, role checks on every route, the postgres.js tagged template only, relative imports in `server/` and `shared/`.
10. **Final report:** what you built (files), how you verified it (commands + results), what's not done, requests for other owners, and any contract you changed.

## Ownership

| Agent | Area | Owns | Migration | Ports |
|---|---|---|---|---|
| A | Design system | `src/components/ui/**`, `src/components/ds/**`, `src/components/common/Logo.tsx`, `src/pages/dev/**`, `src/index.css`, `src/form-types/icons.ts` | — | 5181 / 8791 |
| B | Form core (shared) | `shared/form/**` **except** `shared/form/settings.ts` and `shared/form/templates/**` | — | — |
| C | Platform (server) | `server/lib/**`, `server/middleware/**`, `server/jobs/**`, `server/test/**`, `server/index.ts`, `server/app.ts` (middleware and error handling only; the route mounts stay as they are), `server/env.ts`, `server/db/migrate.ts`, `server/routes/{auth,setup,me,team,invites,settings,uploads}.ts`, `shared/api.ts`, `shared/auth.ts`, `shared/settings-app.ts`, `.github/**`, `Dockerfile`, `.dockerignore`, `playwright.config.ts`, `e2e/platform.spec.ts`, `.env.example` | `0002_platform.sql` | 5183 / 8793 |
| D | Forms management | `server/routes/{forms,templates}.ts`, `shared/form/settings.ts`, `shared/form/templates/**`, `shared/api-forms.ts`, `server/db/seed.ts`, `src/pages/dashboard/{FormsPage,TemplatesPage}.tsx`, `src/pages/dashboard/forms/**`, `e2e/forms.spec.ts` | `0003_forms.sql` | 5184 / 8794 |
| E | Respondent | `src/respondent/**`, `form.html`, `src/form-types/renderers.tsx`, `src/form-types/*/Renderer.tsx`, `server/routes/public-forms.ts`, `server/respondent/**`, `public/embed.js`, `shared/api-public.ts`, `src/pages/public/PublicFormPage.tsx`, `e2e/respondent.spec.ts` | `0006_respondent.sql` | 5185 / 8795 |
| F | Builder | `src/pages/builder/**` **except** `src/pages/builder/responses/**`, `src/builder/**`, `src/form-types/settings.tsx`, `src/form-types/*/{Settings,ConditionValue}.tsx`, `server/routes/themes.ts`, `server/routes/builder/**`, `shared/api-builder.ts`, `e2e/builder.spec.ts` | `0007_builder.sql` | 5186 / 8796 |
| G | Responses | `src/pages/builder/responses/**`, `src/form-types/summaries.tsx`, `src/form-types/*/SummaryCard.tsx`, `server/routes/responses.ts`, `server/responses/**`, `shared/api-responses.ts`, `e2e/responses.spec.ts` | `0004_responses.sql` | 5187 / 8797 |
| H | Public site and settings UI | `server/lib/public-site.ts`, `server/routes/public.ts`, `shared/api-front.ts`, `src/pages/public/{HomePage,AboutPage,AllFormsPage,LegalPage}.tsx`, `src/pages/public/home/**`, `src/pages/dashboard/{SettingsPage,ProfilePage}.tsx`, `src/pages/dashboard/settings/**`, `e2e/public-site.spec.ts` | `0005_front_page.sql` | 5188 / 8798 |

**Wave 3:** these agents take over areas whose original owners (A, B, C, D, H) have finished.

| Agent | Area | Owns | Migration | Ports |
|---|---|---|---|---|
| I | QA and polish (UI) | `src/pages/dashboard/**`, `src/pages/auth/**`, `src/pages/public/{HomePage,LegalPage}.tsx`, `src/pages/public/home/**`, `src/components/ds/**`, `src/components/ui/**`, `src/components/common/**`, `src/pages/dev/**` | — | 5189 / 8799 |
| J | Security and code review (server) | `server/lib/**`, `server/middleware/**`, `server/routes/{auth,setup,me,team,invites,settings,uploads,forms,templates,front-page,public}.ts`, `server/db/seed.ts`, `shared/{api,auth,settings-app,api-forms,api-front}.ts`, `shared/form/settings.ts`, `shared/form/templates/**`, `server/test/**` (except files of E/F/G) | `0008_hardening.sql` | 5190 / 8800 |
| K | End-to-end and CI | `e2e/journey.spec.ts`, `e2e/templates.spec.ts`, `e2e/helpers/**`, `server/test/templates-submit.int.test.ts`, `playwright.config.ts`, `.github/**`, `Dockerfile` | — | 5191 / 8801 |

**Wave 4:** follow-ups in the finished areas of E, G, B, D and A.

| Agent | Area | Owns | Migration | Ports |
|---|---|---|---|---|
| L | Security follow-ups (server) | `server/respondent/**`, `server/routes/public-forms.ts`, `shared/api-public.ts`, `server/responses/**`, `server/routes/responses.ts`, `shared/api-responses.ts`, `server/routes/forms.ts`, `shared/form/settings.ts`, `shared/form/types/advanced.ts` (signature answer only) | `0009_followups.sql` | 5192 / 8802 |
| M | Respondent bundle and labels | `shared/form/**` (except `settings.ts` and the signature answer in `types/advanced.ts`), `src/respondent/**`, `src/form-types/*/Renderer.tsx`, `src/form-types/renderers.tsx`, `src/index.css`, `src/styles/form-theme.css` (new) | — | 5193 / 8803 |

Shared, owned by the lead (ask in your report): `src/router.tsx`, `src/main.tsx`, `src/lib/**`, `src/components/layout/**`, `src/components/common/{Field,PageHeader,Placeholder}.tsx`, `vite.config.ts`, `tsconfig*.json`, `package.json`, `CLAUDE.md`, `README.md`, `docs/PLAN.md`.

## Contracts between agents

Keep these export names stable. Add to them freely; don't rename them.

**Form core (B): `shared/form/`**
- `definition.ts`: `formDefinition`, `FormDefinition`, `FormField`, `LogicRule`, `Condition`, `CONDITION_OPS`, `blankDefinition()`, `LAYOUTS`, `Layout`, `LAYOUT_LABEL`, `newFieldId()`, `newOptionId()`.
- `field-types.ts`: `FIELD_TYPES`, `FieldType`, `FIELD_GROUPS`, `FIELD_GROUP_LABEL`, `FIELD_TYPE_META`.
- `types/registry.ts`: `coreRegistry: Record<FieldType, FieldTypeCore>` (see `docs/research/02-builder.md`).
- `logic.ts`: `computeVisibility`, `pruneAnswers`, `validateSubmission`, `lintLogic`, `dependentsOf`, `orderViolations`, `interpolate`, `PIPE_RE`.
- `theme.ts`: `formTheme` (zod), `FormTheme`, `THEME_PRESETS`, `defaultTheme()`, `themeToVars(theme): Record<string, string>`, `contrastRatio(a, b)`, `themeContrastIssues(theme)`, `THEME_FONTS`.
- `labels.ts`: `SYSTEM_LABELS` (default text for Start, Next, Back, Submit, OK, Press Enter, required error…), `resolveLabels(overrides)`.
- `safe-url.ts`: `safeUrl` (zod, http/https only).
- `csv.ts`: per-type answer → CSV cell(s), using the registry.

**Forms management (D)**
- `shared/form/settings.ts`: `formSettings` (zod), `FormSettings`, `defaultFormSettings()`, covering every PRD "Form settings" group (access and limits, after submit, notifications, webhook, spam). Forms have no language setting or label overrides: respondent text is the fixed English `SYSTEM_LABELS` in `shared/form/labels.ts`.
- `shared/form/templates/`: `BUILTIN_TEMPLATES`.

**Platform (C): `server/lib/`**
- `ip.ts`: `clientIp(c)`.
- `rate-limit.ts`: `rateLimit(key, limit, windowSeconds)` (Postgres-backed, async, throws 429).
- `jobs.ts`: `enqueue(tx, kind, payload, opts?)`, `registerJob(kind, handler)`.
- `email.ts`: `queueEmail(tx, message)`, `emailEnabled()`.
- `uploads.ts`: `storeImage(file, purpose)` → `{ url }`, `storeBuffer(buf, contentType, path)`.
- `webhooks.ts`: `signWebhook`, `deliverWebhook(formId, payload, { test })`, `assertSafeUrl(url)`.
- `csv.ts`: `csvEscape`, `csvRow`, `CSV_BOM`.
- `request-meta.ts`: `requestMeta(c)` → `{ ipHash, country, device, browser }`.
- `settings.ts`: `getSetting` / `setSetting` (exists), plus secret helpers.
- `logger.ts`: `logger`.

**Respondent renderer (E):** `src/respondent/FormRenderer.tsx` exports `FormRenderer`, used by the builder preview (F):

```ts
interface FormRendererProps {
  definition: FormDefinition
  theme: FormTheme
  labels?: Record<string, string>
  mode: 'live' | 'preview'          // preview: no network, no Turnstile, submit just shows the end screen
  device?: 'desktop' | 'mobile'     // preview width hint
  onSubmit?: (answers: Record<string, unknown>, meta: { startedAt: number; ttc: Record<string, number> }) => Promise<{ ok: true } | { ok: false; errors: Record<string, string> }>
}
```

**Field-type UI registries (one file per agent, no shared file):**
- `src/form-types/icons.ts` (A): `FIELD_ICONS: Record<FieldType, LucideIcon>`.
- `src/form-types/renderers.tsx` (E): `FIELD_RENDERERS`.
- `src/form-types/settings.tsx` (F): `FIELD_SETTINGS`, `CONDITION_VALUE_INPUTS`.
- `src/form-types/summaries.tsx` (G): `SUMMARY_CARDS`.

**Design-system components (A): `src/components/ds/`:** `StatusBadge`, `ChoiceOption` + `ChoiceGroup`, `NpsScale`, `NpsSummaryBar`, `ProgressBar`, `TextField`, `EmptyState`, `StatCard`.

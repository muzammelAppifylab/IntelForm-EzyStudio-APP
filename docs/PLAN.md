# IntelForm build plan

Our own plan, built from the research in `docs/research/` (not the research pack's milestones). The build runs as parallel agents with strict file ownership. Who owns what is in [AGENTS.md](AGENTS.md).

## Research behind it

| File | Covers |
|---|---|
| [01-product-ux.md](research/01-product-ux.md) | How Typeform, Tally, Formbricks, HeyForm, OpnForm and others solve builder, renderer, results and embed UX; what to adopt and avoid |
| [02-builder.md](research/02-builder.md) | Drag and drop, state and undo, autosave and conflicts, piping chips, field-type registry, logic engine, theme, preview |
| [03-respondent.md](research/03-respondent.md) | Field inputs (phone, date, signature…), embeds, Turnstile and the spam pipeline, one-per-browser, accessibility, performance budget, licence flags |
| [04-backend-infra.md](research/04-backend-infra.md) | EzyStudio unknowns, Bunny uploads, email drivers, outbox jobs, webhooks + SSRF, CSV/ZIP, geo/UA, packaging, questions for EzyStudio |
| [05-data-analytics.md](research/05-data-analytics.md) | Answer storage, summary SQL, table search/pagination, benchmarks |
| [06-security-quality.md](research/06-security-quality.md) | Review of the current code (A1–A13), headers, testing strategy, CI, tooling |

## Key technical decisions

| Area | Decision |
|---|---|
| API | Hono on web-standard Request/Response. One app (`server/app.ts`), portable to EzyStudio's runtime once confirmed |
| Database | Postgres 17, postgres.js tagged templates, numbered SQL migrations, outbox `jobs` table for after-reply work |
| Form model | Versioned JSON definition. The field-type registry is split into a pure `shared/` core (props, answer validation, operators, CSV) and React parts in `src/form-types/` |
| Logic | Pure forward-pass engine shared by browser and server. Rules reference earlier fields only, so there are no cycles. The server re-validates every submission |
| Builder | zustand + immer, our own undo history (100 steps), 1 s debounced autosave with a revision counter (last save wins, with a banner), presence by polling, @dnd-kit/react with keyboard support, TipTap mention chips for piping |
| Renderer | One renderer, three layouts. Its own Vite entry (`form.html`) with the form JSON inlined, budget ≤ 110 KB gz initial JS. Same-document preview in the builder |
| Spam | Order: body limit, form checks, Postgres rate limit (hashed IP), honeypot + minimum time, validation, Turnstile siteverify, dedupe, transactional insert |
| Embeds | Our own ~1.5 KB `embed.js` (iframe-resizer v5 is GPL), `frame-ancestors *` only on `/f/*` |
| Uploads | Proxied through the API to Bunny Storage (no presigned uploads), with a local-disk driver when Bunny isn't configured; SVG sanitised or rejected |
| Email | One interface: none / console / SMTP / Resend / Postmark, configured in App settings, sent through jobs |
| Webhooks | Standard Webhooks signing, SSRF-safe undici agent, delivery log of 100, manual resend, no automatic retries |
| Privacy | Raw IPs never stored (HMAC with HKDF subkey); country only from a trusted proxy header; bowser for UA (ua-parser-js 2 is AGPL) |
| Quality | Vitest unit + real-Postgres integration tests, Playwright e2e with axe, Lighthouse and bundle budgets in CI |

## Phases and owners

**Wave 1 (running):** foundations other work builds on.

| Agent | Delivers |
|---|---|
| A: Design system | Every shadcn primitive tuned to spec (2px focus ring, radii, elevation, field tokens); `StatusBadge`, `ChoiceOption/Group`, `NpsScale`, `NpsSummaryBar`, `RatingScale`, `ProgressBar`, `TextField`, `EmptyState`, `StatCard`; field icons; `/design-system` page; axe-clean |
| B: Form core | 21-type registry, discriminated-union definition, logic engine + piping, themes (8 presets, `themeToVars`, contrast), system labels, safe URLs, CSV encoding; property-based tests |
| C: Platform | Security fixes A1–A13, per-surface CSP, Postgres rate limits, jobs + scheduler, email drivers, uploads (Bunny or local disk), webhooks, CSV, request meta, logging, health, App settings API, test harness, Dockerfile, CI, Playwright config |
| D: Forms management | Form settings schema, forms API (list, create, autosave with revision, publish with lint, close/reopen, duplicate, delete), 10 built-in templates + seed, forms list and templates pages |

**Wave 2 (starts when A, B and C land):** the product surfaces.

| Agent | Delivers |
|---|---|
| E: Respondent | `/f/:slug` with its own entry; all 21 renderers; 3 layouts with focus management, keyboard rules, auto-advance rules, error summary, progress; start/end screens with piping; password gate; closed message; funnel events; the submit route with the full spam pipeline and validation; signature upload; jobs for notifications and webhooks; `embed.js` inline + popup |
| F: Builder | Builder shell and header (save state, counts, preview, publish, presence banner); Build tab (palette, `/` insert, canvas with dnd and inline editing, settings panel per type, logic editor with sentence chips, piping chips, warnings); Design tab (presets, colours, fonts, background, logo, contrast warnings, saved themes); Settings tab; Share tab (link, slug, SEO, embeds, QR, front page toggle); undo/redo; shortcuts |
| G: Responses | Summary (top cards, time series, per-question cards, NPS, funnel, per-question time); table (columns, search, filters, sort, pagination, bulk delete); drawer with labels as submitted; streamed CSV; SQL aggregates meeting 10k responses in under 2 s |
| H: Front page and settings UI | Front page editor + public home (hero, featured forms, about, contact, SEO), privacy/terms; App settings UI for every group; profile avatar |

**Integration (lead):** router and shared wiring, seeding on boot, full typecheck, lint, tests, build, e2e across areas, a Lighthouse pass on `/f/*`, README update.

## Definition of done

- `npm run typecheck && npm run lint && npm test && npm run build` pass.
- Playwright: setup → invite → create from template → edit in builder → publish → submit in each layout → response appears in summary and table → CSV export; embed works in an iframe; axe has no violations on `/f/*` in all layouts.
- Every PRD acceptance criterion is met, or listed below as open.

## Open questions (need a decision outside the code)

1. **EzyStudio runtime.** Request time limits, streaming, background work, instances, Postgres pooling, Bunny credentials, trusted proxy headers, outbound SMTP and HTTP. The full list is in [04-backend-infra.md](research/04-backend-infra.md#questions-for-ezystudio).
2. **Email provider.** The code supports SMTP, Resend and Postmark; the Owner picks one in Settings.
3. **Signature accessibility.** "Draw only" fails WCAG 2.1.1. Add a "type your name" option?
4. **Per-question drop-off.** Add a `reach` event per step (no answer content)?
5. **Auto-advance** as a per-form toggle (default on)?
6. **Template licence.** It affects the DB-IP credit (if used) and the third-party notices.

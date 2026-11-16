# IntelForm

A private, multi-layout survey and form builder, shipped as an EzyStudio marketplace template. The creator and the team they invite build forms in a private dashboard. Respondents fill them in at `/f/:slug` without an account: as a full page, an inline embed, a popup, or from the creator's public forms hub at `/`.

- **Spec:** the PRD in `../IntelForm-Research/`.
- **Research and plan:** [docs/research/](docs/research/) and [docs/PLAN.md](docs/PLAN.md).

## Run it

You need Node 22+ and Docker (for a local Postgres).

```bash
npm install
cp .env.example .env      # then set APP_SECRET (the command is in the file)
npm run db:up             # Postgres 17 on localhost:5433
npm run db:migrate
npm run dev               # app on http://localhost:5173, API on :8787
```

Open http://localhost:5173. On an empty database it sends you to `/setup`, where you create the Owner account. Everyone else joins by invite from the Team page. The 10 built-in templates are seeded automatically when the server starts, or with `npm run db:seed`.

| Script | What it does |
|---|---|
| `npm run dev` | Vite and the API together; Vite proxies `/api` |
| `npm run build` | Type-checks everything, then builds `dist/`: the dashboard app plus a separate lightweight respondent bundle (`form.html`) |
| `npm start` | Production: one Node process serves the API, `dist/`, and `/f/*` with the form JSON inlined |
| `npm run db:migrate` / `db:seed` | Apply new SQL migrations, or upsert the built-in templates |
| `npm test` | Vitest: shared unit tests plus API integration tests against a real Postgres |
| `npm run test:e2e` | Playwright end-to-end tests (production build, Chrome, 1 worker) |
| `npm run check:bundle` | Fails if the public form's initial JS is over budget |
| `npm run typecheck` · `npm run lint` | tsc · oxlint |

**Docker:** `Dockerfile` (node:24-slim, non-root, health check on `/api/health`). Set `MIGRATE_ON_BOOT=1` to apply migrations at start.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `APP_SECRET` | 32+ random characters. Encrypts stored secrets and keys the IP hashes. Back it up: stored secrets are unrecoverable without it |
| `APP_SECRET_PREVIOUS` | The old secret while rotating |
| `APP_URL` | Public site URL; required in production. When it is https, cookies are `Secure` with the `__Host-` prefix |
| `API_PORT` | Server port (default 8787) |
| `MIGRATE_ON_BOOT` | `1` applies pending migrations at start |
| `TRUSTED_PROXY_HOPS` | How many proxies sit in front of the app (for the client IP). 0 = use the socket address. **Required behind a proxy or CDN**, or every visitor shares one rate limit |
| `COUNTRY_HEADER` | A trusted header carrying the visitor's country, e.g. `CF-IPCountry` |
| `EMAIL_DRIVER` | Development override: `console` prints emails to the log. Otherwise the provider is chosen in App settings (SMTP, Resend or Postmark) |
| `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_KEY`, `BUNNY_STORAGE_REGION`, `BUNNY_CDN_URL` | Image storage (provided by EzyStudio). When unset, uploads go to local disk (`UPLOADS_DIR`, default `./uploads`) |
| `ALLOW_PRIVATE_WEBHOOKS` | Development only: allow webhooks to localhost and private IPs |
| `LOG_LEVEL` | pino log level |

The Turnstile keys, email provider, branding and data retention are set by the Owner in **Settings**, not in env. Secrets are stored encrypted and are never shown again.

## Going live

Required:

- A real `APP_SECRET`, backed up. Stored secrets can't be recovered without it.
- An https `APP_URL`.
- `TRUSTED_PROXY_HOPS` set to the number of proxies in front of the app (set by EzyStudio), so rate limits see real visitor IPs. With the default 0 behind a proxy, all visitors share one limit and real people get turned away.
- An email provider, configured and tested in Settings. Without one there are no password resets or emailed invites.
- Bunny storage (provided by EzyStudio). Without it, uploads go to local disk and can vanish on a redeploy.

Recommended:

- Turnstile keys in Settings → Spam protection, once forms start getting spam. Without them, forms are still protected by the honeypot and rate limit. Turnstile keys are tied to the site's domain, so each install needs its own from Cloudflare.

## What's in it

- **Accounts:**
  - First-run setup.
  - Invite-only team: Owner / Editor / Viewer.
  - Change role, remove a member, transfer ownership, Owner-set passwords.
  - Password reset by email.
  - Profile with avatar.
- **Forms list:**
  - Search, filter, sort, grid and list views, a weekly strip.
  - Create blank or from 10 templates.
  - Duplicate, close/reopen, delete with typed confirm, save as template.
- **Builder:**
  - Three panes; drag and drop with keyboard alternatives; a `/` insert menu.
  - Inline editing; 21 field types with their own settings.
  - Show/hide logic shown as sentences; `@` answer piping with fallbacks.
  - Undo/redo; autosave with conflict banners; presence.
  - Desktop/mobile preview; publish with versions and a pre-publish check.
  - Design tab: 8 presets, colours, 12 fonts, background, logo, contrast warnings, saved themes.
  - Settings tab: access and limits, password, after submit, notifications, webhook with log, spam, labels.
  - Share tab: link and slug, SEO, inline and popup embeds, QR code, front page toggle.
- **Public form:**
  - All at once / section by section / one at a time, with full keyboard and screen-reader support.
  - Start and end screens, password gate, closed message.
  - Honeypot + rate limiting, plus optional Cloudflare Turnstile.
  - One response per browser or per email; response cap.
  - Notifications, confirmation emails and signed webhooks, sent after the reply.
  - `embed.js` for inline and popup embeds.
- **Responses:**
  - Summary: funnel, responses over time, a card per question, NPS, CSAT, time per question.
  - Table: search, filters, sort, column preferences, bulk delete.
  - Response drawer with labels as submitted.
  - Streamed CSV export.
- **Public site:** home (the forms hub), About, Forms, Privacy and Terms. The pages and their copy are code in `src/pages/public`: edit them there. Each form's Share tab lists it on the homepage; Settings → Public site holds search indexing, the description, the social image and the Privacy and Terms texts.
- **App settings:** general, branding (accent colour, favicon), public site (search and sharing, privacy and terms), spam keys, email provider with a test send, storage test, retention, and a ZIP export of every response.

## Structure

```
shared/                Code the browser and the server both import
  form/                Form core: 21-type registry, definition, logic + piping, themes, labels, CSV, settings, templates
  roles.ts, auth.ts    Permissions and auth schemas
  api*.ts              Request and response contracts per area
server/                The API (Hono, Web-standard Request/Response)
  app.ts               Every /api route; the unit that maps onto EzyStudio API routes
  index.ts             Node listener, per-surface security headers, static files, inlined form pages
  routes/              setup, auth, me, team, invites, settings, uploads, forms, templates, themes, builder, responses, public, public-forms
  respondent/          Public form loading and the submit pipeline
  responses/           Table, summary SQL, CSV
  lib/                 sessions, rate limits, jobs (outbox) + scheduler, email drivers, uploads, webhooks, crypto, logging
  db/                  postgres.js client, migration runner, SQL migrations, template seed
src/                   The React app
  styles/              IntelForm design system tokens + form theme scope
  components/ui, ds/   shadcn/ui tuned to the design system, plus IntelForm components
  form-types/          Per-type UI: icons, renderers, settings panels, summary cards
  builder/             Builder store (zustand), autosave, ops, piping editor
  respondent/          The respondent renderer (its own entry: form.html)
  pages/               public/, auth/, dashboard/, builder/, dev/ (/design-system in development)
e2e/                   Playwright specs and helpers
docs/                  Plan, research, contracts, design reference
```

## Decisions to know

- **API shape.** The PRD's "EzyStudio API routes" are unspecified, so the API is a portable Hono app; the questions for EzyStudio are in [docs/research/04-backend-infra.md](docs/research/04-backend-infra.md).
- **Work after the reply.** Emails and webhooks go through a Postgres outbox (`jobs`) with an in-process worker, so nothing is lost on restart. Scheduled work (closing forms on their close date, retention, clean-up) uses lease rows, so it is safe with several instances.
- **Privacy.**
  - Raw IPs are never stored (HMAC).
  - Tokens (sessions, invites, resets) are stored hashed.
  - Respondent pages are self-hosted with no third-party fonts.
- **Licences.** Every dependency is MIT, ISC, Apache-2.0 or MPL-2.0. AGPL ua-parser-js 2.x and GPL iframe-resizer v5 were deliberately avoided.

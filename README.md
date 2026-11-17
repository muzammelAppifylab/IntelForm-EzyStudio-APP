# IntelForm

**IntelForm** is a form builder for one business: build forms (bookings, questions, feedback,
sign-ups, waitlists) in the dashboard, publish them at `/f/<slug>`, and read, chart, export and act
on the answers. It runs on the EzyStudio web-app template: [Astro](https://astro.build) pages and a
[Hono](https://hono.dev) backend at `/site-api` on one Cloudflare Worker, Postgres through
[Prisma ORM 7](https://www.prisma.io), and a React dashboard at `/dashboard`
([TanStack Router](https://tanstack.com/router) and [Query](https://tanstack.com/query)) on the
template's own UI kit (`src/portal/ui/`), dressed in IntelForm's "paper & ink" look.

- **Builder**: 21 question types (short and long text, email, phone, URL, number, date, time, name,
  address, country, single and multiple choice, picture choice, dropdown, yes/no, rating, NPS,
  consent, signature, section breaks), conditional logic and answer piping, three layouts (one
  question at a time, paged, all at once), design themes and fonts, drafts with autosave, a live
  preview, and publish (each publish kept as a version).
- **Sharing**: a public page per form (`/f/<slug>`; a renamed slug keeps redirecting), embedding
  (inline or popup, `public/embed.js`), a QR code, password protection, close dates and response
  limits, Cloudflare Turnstile plus a honeypot, minimum fill time and rate limits against spam.
- **Responses**: a table with filters, column choices and a detail drawer, a summary with a chart
  per question, CSV and ZIP export (uploaded files and signatures included) as a background job,
  and deletion.
- **Contacts**: everyone who answered, rolled up by email address, with filters, a drawer, CSV
  export and erasure.
- **After a submission**: an email to the owner (the platform's relay), optional emails to
  teammates and a confirmation to the respondent (these need a mail provider, see
  [Owner secrets](#owner-secrets)), signed webhooks with retries, a thank-you screen or a redirect.
- **Templates and themes**: built-in starter templates, your own forms saved as templates, reusable themes.
- **Public site**: a home page and `/forms/` listing the forms marked "Show on the homepage", an
  about page, Privacy and Terms (their texts are set in Settings), sitemap and RSS.
- **Accounts, team and roles** are the template's: sign-up, sign-in, two-step sign-in, users, roles
  and the activity log. IntelForm adds the roles **Editor** and **Viewer** (a migration) and these
  permissions:

| Permission | What it allows | admin | editor | viewer |
| --- | --- | :-: | :-: | :-: |
| `site:form:read` | see forms | yes | yes | yes |
| `site:form:write` | create, edit, duplicate, publish and close forms; form settings, webhooks, templates | yes | yes | |
| `site:form:delete` | delete forms | yes | yes | |
| `site:response:read` | read and export responses | yes | yes | yes |
| `site:response:delete` | delete responses | yes | yes | |
| `site:contact:read` | read and export contacts | yes | yes | yes |
| `site:contact:write` | change and erase contacts | yes | yes | |
| `site:intelform:settings` | the app's Settings screen | yes | | |

The owner holds every permission. They are declared once, in `src/server/permissions.ts`.

## Where each feature lives

| Feature | Dashboard and pages | Site API | Shared code |
| --- | --- | --- | --- |
| Forms list, overview | `src/portal/screens/forms.tsx`, `overview.tsx`, `src/portal/intelform/forms/` | `src/server/routes/forms.ts`, `src/server/intelform/forms/` | `src/lib/intelform/api-forms.ts` |
| Builder (build, design, settings, share) | `src/portal/screens/builder/`, `src/portal/intelform/builder/` | `src/server/routes/builder.ts`, `src/server/intelform/builder/` | `src/lib/intelform/form/` (definition, logic, validation) |
| Question types | `src/form-types/<type>/` (editor, answer input, summary) | | `src/lib/intelform/form/types/` |
| Responses | `src/portal/screens/builder/responses.tsx`, `src/portal/intelform/responses/` | `src/server/routes/responses.ts`, `exports.ts`, `src/server/intelform/responses/`, `exports/` | `src/lib/intelform/api-responses.ts`, `api-exports.ts` |
| Contacts | `src/portal/screens/contacts.tsx`, `src/portal/intelform/contacts/` | `src/server/routes/contacts.ts`, `src/server/intelform/contacts/` | `src/lib/intelform/api-contacts.ts` |
| Templates and themes | `src/portal/screens/templates.tsx` | `src/server/routes/templates.ts`, `themes.ts`, `src/server/intelform/templates/`, `themes/` | |
| App settings | `src/portal/screens/app-settings.tsx`, `src/portal/intelform/settings/` | `src/server/routes/app-settings.ts`, `src/server/intelform/settings/` | `src/lib/intelform/settings-app.ts` |
| Public form page | `src/pages/f/[slug].astro`, `src/respondent/` | `src/server/routes/public-forms.ts`, `src/server/intelform/respondent/` | `src/lib/intelform/api-public.ts` |
| Uploads and signatures | `src/portal/intelform/upload.ts` | `src/server/routes/uploads.ts`, `src/server/intelform/uploads/` (the platform's file storage) | |
| Notifications, webhooks, jobs | | `src/server/intelform/notify/`, `webhooks/`, `src/server/background.ts`, `background.json` | |
| Public site (home, `/forms/`) | `src/pages/index.astro`, `src/pages/forms/`, `src/components/public-site/` | `src/server/routes/public-site.ts`, `src/server/intelform/public-site/` | `src/lib/intelform/api-front.ts` |
| The look ("paper & ink") | `src/styles/base.css` (tokens), `src/styles/app.css`, `src/form-types/*.css` | | |
| Database | `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.sql` | | |

Background work (`background.json`, handlers in `src/server/background.ts`):
`intelform-response-notify` (emails after a submission), `intelform-webhooks` and
`intelform-webhook-deliver` (webhooks, with retries), `intelform-exports` (CSV and ZIP exports,
in parts), `intelform-file-cleanup` (stored files of deleted responses), and two schedules:
`intelform-retention` daily at 04:30 (deletes responses older than the app-wide retention period,
Settings > Data: one period for every form, off by default; exports holding them stop and the
cached summary and contacts are cleared) and `intelform-maintenance` hourly (closes forms past
their close date, trims logs, marks exports whose job stopped as failed).

## What an owner usually changes

- **The public site's words**: `src/content/site.ts` (navigation, home sections, `/forms/` and
  about copy). Without a Publish: the site's name and logo (the platform), which forms are listed
  (each form's Share tab, "Show on the homepage"), and the contact email, search and sharing,
  Privacy and Terms (dashboard › Settings › Public site).
- **The look**: the colour, type and radius tokens at the top of `src/styles/base.css`; per form,
  the builder's Design tab (theme, fonts, colours, logo).
- **App settings** (dashboard › Settings, admins only): the app's name and branding, date format and
  colour mode, how long responses are kept, spam protection, notification defaults.
- **Built-in templates**: `src/server/intelform/templates/builtins.ts`.
- **Who can do what**: dashboard › Roles (the owner): give a role any of the permissions above.
- **Sample data**: `prisma/seed.sql` (sample forms with responses, contacts and themes).

### Owner secrets

Secrets are never in a file or in the database: the site's owner adds them on the platform as
**owner secrets**, and the server reads them with `config.ownerSecret('NAME')`. All are optional.

| Secret | What it turns on |
| --- | --- |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile on public forms: the widget's (public) site key |
| `TURNSTILE_SECRET_KEY` | the widget's secret key. Both are needed: create a widget in the Cloudflare dashboard under Turnstile, for this site's domain. Settings › Spam protection shows whether each is set and has **Test keys**. Without them forms still have a honeypot, a minimum fill time and rate limits; each form can also turn Turnstile off in its settings. |
| `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` | a mail provider for emails with the form's own text: teammate notifications and the respondent's confirmation |
| `EMAIL_FROM_ADDRESS` | the sender of those emails, on a domain verified with that provider |

Without a mail provider the owner's "new response" email still goes through the platform's relay;
teammate and confirmation emails are skipped. On your computer every email is printed where
`npm run dev` runs instead ([Local development mode](#local-development-mode)).

## Contents

- [Where each feature lives](#where-each-feature-lives) ·
  [What an owner usually changes](#what-an-owner-usually-changes) · [Owner secrets](#owner-secrets)
- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Setting up, step by step](#setting-up-step-by-step)
  - [Get the code](#get-the-code) · [Install](#install) · [Settings (.env)](#settings-env) ·
    [The database](#the-database) · [Run it](#run-it)
- [Local development mode](#local-development-mode)
- [Create your admin account](#create-your-admin-account)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Building on it](#building-on-it) (what not to edit, the database, sample data)
- [Tests](#tests)
- [Staying up to date](#staying-up-to-date)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [On the platform](#on-the-platform) (publishing, accounts, addresses)

## Quick start

With [Node.js 22.12+](#requirements) and Docker running:

```bash
git clone <this repository's address> intelform
cd intelform
npm install
docker compose up -d --wait db      # a local Postgres (docker-compose.yml)
npm run setup                       # .env with a new JWT_SECRET, database check, tables
npm run db:seed                     # sample forms, responses and contacts
npm run dev                         # http://localhost:4321
```

Port 5432 already taken? Put `DB_PORT=5433` (any free port) in `.env` before
`docker compose up`, and the same port in `DATABASE_URL` ([Troubleshooting](#troubleshooting)).

Then [create your admin account](#create-your-admin-account): sign up at
http://localhost:4321/account/register/, type the code printed by `npm run dev`, and run
`npm run dev-admin -- you@example.com`. The sample forms are at http://localhost:4321/forms/ and
in the dashboard under Forms.

## Requirements

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 22.12 or later (`.nvmrc` says 22: `nvm use`) | `node -v` |
| npm | the one that comes with Node.js | `npm -v` |
| Docker | any recent Docker Desktop or Engine with `docker compose` | `docker compose version` |
| git | any | `git --version` |

No Docker? Any Postgres 15 or later on your computer works: put its address in `DATABASE_URL`
([Settings](#settings-env)).

## Setting up, step by step

`npm run setup` does [Settings](#settings-env) and [The database](#the-database) for you (not the sample data); this is what it does, and how to do it by hand.

### Get the code

IntelForm is a clone of the EzyStudio web-app template with the app built on top, so template
releases merge into it ([Staying up to date](#staying-up-to-date)). Clone this repository and add
the template as `upstream`:

```bash
git clone <this repository's address> intelform
cd intelform
git remote add upstream https://github.com/EzyStudio/web-app-template.git
git fetch upstream --tags
```

`node store-check.mjs` and `npm run platform -- check` read the release tags from `upstream`.
Don't copy the files into a fresh repository: that loses the shared history, and `git merge` can
no longer tell IntelForm's changes from the template's. Already did? See
[Started from a copy](#started-from-a-copy).

### Install

```bash
npm install
```

### Settings (.env)

`npm run setup` makes `.env` from `.env.example`, generates a `JWT_SECRET` and points
`DATABASE_URL` at the local database. It never overwrites a value you set. By hand:
`cp .env.example .env` and fill in the two required values. `.env` stays on your computer (git
ignores it): never commit it. Restart `npm run dev` after changing it.

| Variable | On your computer | What it is |
| --- | --- | --- |
| `DATABASE_URL` | **required** | the Postgres connection string. Local: `postgresql://postgres:dev@localhost:5432/site`. |
| `JWT_SECRET` | **required**, 32+ random characters | signs sign-in tokens and keys the rate limits. Make one: `openssl rand -base64 48`. |
| `SITE_KEY` | **leave empty** | the secret the platform gives hosted sites to send account emails. Empty turns on [local development mode](#local-development-mode). |
| `SITE_URL` | leave empty | the site's address on the platform, where it answers `/api/*`. |
| `SITE_PREVIEW` | leave empty | `1` only in the platform editor's Preview. |
| `SITE_OWNER_ID` | leave empty | the platform's opaque id for the account's owner. |
| `DB_PORT` | optional | the port `docker-compose.yml` publishes when 5432 is taken ([Troubleshooting](#troubleshooting)). The site never reads it. |
| `TEST_DATABASE_URL` | optional | a throwaway database for the integration tests ([Tests](#tests)). |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, … | optional | on your computer, [owner secrets](#owner-secrets) are read from `.env` under the same names. Use Cloudflare's Turnstile test keys here, never a live site's keys. |

### The database

`docker-compose.yml` runs Postgres 16 with a database named `site` (user `postgres`, password `dev`),
kept in a Docker volume between restarts:

```bash
docker compose up -d --wait db    # start (and wait until it is ready)
docker compose stop db            # stop, keeping the data
docker compose down -v            # delete it, data included: start from empty
```

Create the tables, and run it again after every new migration (yours or a template release's):

```bash
npm run db:migrate                # prisma migrate deploy
npm run db:seed                   # optional: the sample data in prisma/seed.sql
```

### Run it

```bash
npm run dev                       # http://localhost:4321
```

If `npm run dev` returns to the prompt with "Dev server running at…", it runs in the background:
`npx astro dev logs` shows its output, `npx astro dev stop` stops it.

### Which database each tool uses

The dev server and the command-line tools read `DATABASE_URL` from different places:

| Tool | Reads `DATABASE_URL` from |
| --- | --- |
| `npm run dev` / `npx astro dev` (the site itself) | `.dev.vars` if that file exists, else `.env` (then `.env.local`). **Never the shell.** |
| `npm run db:migrate`, `npm run db:seed`, `npx prisma …`, `npm run dev-admin` | the shell first, else `.env` |

So `DATABASE_URL=…/other npm run dev` still reads, writes and **deletes** in the `.env`
database, while `DATABASE_URL=…/other npm run db:migrate` changes `other`. To make the site
use another database, change `DATABASE_URL` in `.env` and restart `npm run dev`.

Both say which database they use, by name, host and port (never the user or password): the dev
server prints `Dev server database: "site" on localhost:5432 (from .env)` as it starts, and
`db:migrate`, `db:seed` and `prisma studio` print `Prisma database: …`. When a `DATABASE_URL`
set in the shell reaches a different database than the dev server's, both print a
**DATABASE MISMATCH** warning naming the two. Pointing the Prisma CLI at the test database on
purpose ([Tests](#tests)) prints it too: that is expected there. (`src/lib/dev-database-target.ts`,
used by `astro.config.mjs` and `prisma.config.ts`.)

## Local development mode

There is no `SITE_KEY` on your computer, so nothing can be emailed. While `npm run dev` runs with
an empty `SITE_KEY`, the site is in **local development mode**: every account email (sign-up and
sign-in codes, reset and confirmation links) is printed where `npm run dev` runs (or in
`npx astro dev logs`), under "LOCAL DEVELOPMENT ONLY", instead of being sent:

```
────────── LOCAL DEVELOPMENT ONLY: this email was not sent ──────────
  sign_up_code → you@example.com
  code: 123456
  link: http://localhost:4321/account/verify/?signup=…
```

It is off as soon as `SITE_KEY` or `SITE_PREVIEW` is set, with `NODE_ENV=production`, and in every
`npm run build` (the check is compiled out), so it is never on a hosted site.

## Create your admin account

On a hosted site the admin is the account's owner, who opens it with "View as admin" in the
dashboard. On your computer nobody can press that, so you make a local admin:

1. Open http://localhost:4321/account/register/ and sign up with any address (`you@example.com`)
   and a password of 10 or more characters.
2. Type the 6-digit code printed by `npm run dev` ([Local development mode](#local-development-mode)).
3. In another terminal, in the project folder:
   ```bash
   npm run dev-admin -- you@example.com
   ```
4. Open (or reload) http://localhost:4321/dashboard/: Forms, Templates, Contacts and Settings are
   there, and Users, Roles and Activity. To try the Editor or Viewer role, sign up a second
   account and give it that role under Users.

`dev-admin` changes your LOCAL database only. It refuses when `SITE_KEY` or `SITE_PREVIEW` is set or
`NODE_ENV=production`, and when `DATABASE_URL` isn't on this computer: its host must be
`localhost`, `*.localhost`, `127.x.x.x`, `::1` or a docker compose service name (one word, no dots).
It never makes an owner, so the few things only the owner can do (editing roles) can't be tried
locally.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run setup` | checks Node.js and packages, makes `.env` (new `JWT_SECRET`), checks the database, creates the tables |
| `npm run dev` | the dev server, http://localhost:4321 |
| `npm run build` | the production build into `dist/` (what the platform builds) |
| `npm test` | unit tests; integration tests too with `TEST_DATABASE_URL` ([Tests](#tests)) |
| `npm run check` | `npm test`, then `npm run build`: run it before you push |
| `npm run db:migrate` | applies new migrations (`prisma migrate deploy`) |
| `npm run db:seed` | loads `prisma/seed.sql` |
| `npm run dev-admin -- <email>` | a local admin ([Create your admin account](#create-your-admin-account)) |
| `npm run studio` | Prisma Studio on http://localhost:5555, to browse the database |
| `npm run preview` | serves the last `npm run build` |
| `npm run platform -- jobs` | checks `background.json` and its handlers |
| `npm run platform -- check` | the template's own files untouched, and is a newer release out ([Staying up to date](#staying-up-to-date)) |
| `npm run platform -- docs --site <a hosted site's address>` | the platform's latest rules for AI agents, into `.platform/docs/` |

## Project structure

```
AGENTS.md                rules for AI agents (CLAUDE.md, GEMINI.md import it)
docs/agent/              the rules by topic: auth, roles, security, performance, database, UI, SEO…
template.json            which template version this is
docker-compose.yml       the local Postgres
scripts/platform.mjs     setup, dev-admin, template updates, checks
background.json          IntelForm's background job lists and schedules
prisma/                  schema.prisma, migrations/, seed.sql (sample forms, responses, contacts)
tests/                   unit tests; tests/intelform/ = IntelForm; tests/integration/ = the Site API on a real Postgres
public/                  files served as they are (_headers: security headers, embed.js: the form embed)
src/
  content/site.ts        navigation, home sections, /forms/ and about copy
  content/blog/          blog posts (Markdown)
  assets/                images optimised at build
  pages/                 pages: index, forms/, f/[slug] (a public form), about, privacy, terms, blog/,
                         account/, dashboard/, site-api/, sitemap, RSS
  portal/                the dashboard (React): routes.tsx, screens/, intelform/ (builder, responses,
                         contacts, settings, queries), ui/ (the UI kit)
  form-types/            each question type's editor, answer input and summary
  respondent/            the public form (React): layouts, logic engine, embed
  server/                YOUR backend: app.ts, routes/, intelform/ (the app's server code),
                         background.ts, auth-settings.ts, permissions.ts
  platform/              the template's managed core (auth, guards, platform calls): never edit
  lib/                   shared types, browser helpers, seo.ts; lib/intelform/ = the form
                         definition, logic and API contracts shared by server and browser
  styles/                base.css (the "paper & ink" tokens), app.css (the dashboard)
```

## Building on it

- **Your code**: `src/server/` (routes), `src/pages/` (pages), `src/portal/` (dashboard screens),
  `src/content/` (words), `src/lib/`, `src/styles/`, `prisma/`. `AGENTS.md` and `docs/agent/` have
  the rules for each: read them, or have your AI read them, before every change.
- **Never edit the template's own files**: `src/platform/`, `docs/agent/`, `AGENTS.md`, `CLAUDE.md`,
  `GEMINI.md`, `template.json`, `CHANGELOG.md`, `scripts/platform.mjs` and `scripts/managed-files.json`.
  Releases replace them (that is how security fixes arrive). Each is compared byte for byte with the
  release `template.json` names: `npm run platform -- check` lists any that changed, and a store
  listing that changed or deleted one is refused. Put one back with
  `git checkout v<your version> -- <file>`. Extend them from your own code. `.gitattributes` keeps
  every text file LF, so a Windows checkout doesn't change them.
- **Changing the database**: a new migration for every change, never an edit to an applied one.
  ```bash
  npx prisma migrate dev --create-only --name add_bookings   # 1. write it
  # 2. wrap prisma/migrations/<…>/migration.sql in BEGIN; … COMMIT;
  npx prisma migrate dev                                      # 3. apply it
  npx prisma generate                                         # 4. the client gets the new model
  ```
  Change tables in steps (add, fill, switch, drop later): `docs/agent/database.md`.
- **Sample data, `prisma/seed.sql`**: made-up rows, never for a live database. Wrap it in
  `BEGIN;` … `COMMIT;`; start with a block that stops with `RAISE EXCEPTION` when real data is
  there; make it safe to run twice (`ON CONFLICT DO NOTHING` or `WHERE NOT EXISTS`); `@example.com`
  addresses, no users or passwords. The shipped one is the example to copy. A web app listed in a
  store must have one with sample data for ITS tables (at least one `INSERT`): the store loads it
  into its review copy and its preview, and into a customer's staging database only when they ask.
- **Before you push**: `npm run check` and `npm run platform -- check`. If this project has a
  `DEVELOPERS.md`, follow its "For your AI" steps (and its ready-to-submit checklist) too.

## Tests

```bash
npm test                          # unit tests
```

Integration tests run the real Site API on a real Postgres and **empty that database first**: give
them a database of their own, never the one you work in.

```bash
docker compose exec db createdb -U postgres site_test
DATABASE_URL=postgresql://postgres:dev@localhost:5432/site_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://postgres:dev@localhost:5432/site_test npm test
```

The `migrate deploy` line points the Prisma CLI at `site_test` on purpose, so it prints a
DATABASE MISMATCH warning ([Which database each tool uses](#which-database-each-tool-uses)).

With `DB_PORT` set, use that port in both addresses instead of 5432.

## Staying up to date

Template releases are tagged `vX.Y.Z` in the template repository you cloned from (`upstream`).
`CHANGELOG.md` says what each changed and whether it is required. With your work committed:

```bash
git fetch upstream --tags
git describe --tags --abbrev=0 upstream/main   # the newest release
git merge "$(git describe --tags --abbrev=0 upstream/main)"
npm install
npm run db:migrate
npm run check
```

Then follow the new `docs/agent/upgrade.md` for anything that release asks of files you changed.

**Conflicts** (git lists them; search for `<<<<<<<`):
- `package-lock.json`: `git checkout --theirs package-lock.json`, then `npm install` (it rebuilds the
  lock for the merged `package.json`), then commit.
- The template's own files (`src/platform/`, `docs/agent/`, `scripts/`, `template.json`,
  `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`): take the template's
  (`git checkout --theirs <file>`). Never keep changes of your own in them: describe your project in `README.md` instead.
- Your files (pages, `src/content/site.ts`, styles): keep your words and look, and bring over what
  the template changed.
- `git merge --abort` puts everything back as it was.

### Started from a copy

No shared history with the template: connect it once, then merge releases as above.

```bash
git remote add upstream <the template repository's address>
git fetch upstream --tags
git merge v<the version in your template.json> --allow-unrelated-histories   # once
git merge "$(git describe --tags --abbrev=0 upstream/main)"                # then the newest release
```

The first merge lists every file that differs from that release (usually only the ones you
changed): keep your side of your own files (`git checkout --ours <file>`) and the template's side
of its own files (`git checkout --theirs <file>`), then commit.

## Troubleshooting

| What you see | Why | Fix |
| --- | --- | --- |
| `npm install` warns `EBADENGINE`, or `npm run setup` says Node.js is too old | Node.js below 22.12 | `nvm install 22`, then `nvm use 22` (or install 22.12+), then `npm install` again |
| `docker compose up` says `Bind for 0.0.0.0:5432 failed: port is already allocated` | another Postgres already uses port 5432 | put `DB_PORT=5433` in `.env` (and `:5433` in `DATABASE_URL` if it is already set), then `docker compose up -d --wait db` and `npm run setup` |
| `npm run setup` says `no database answers at localhost:5432` (or `ECONNREFUSED`) | the database isn't running, or Docker isn't | start Docker, then `docker compose up -d --wait db`, then `npm run setup` |
| sign-up answers 503 `auth_not_configured`: "Sign-in is not set up on this site yet" | `JWT_SECRET` is missing or shorter than 32 characters | `npm run setup` (or `openssl rand -base64 48` into `.env`), then restart `npm run dev` |
| pages or sign-in answer 503 `site_database_disabled` | `DATABASE_URL` is empty | `npm run setup`, then restart `npm run dev` |
| sign-up answers 500, and the dev server shows `relation "login_attempts" does not exist` or `The table public.permissions does not exist` | the tables aren't created (migrations pending) | `npm run db:migrate` |
| no code appears after signing up | `SITE_KEY` is set (codes are then emailed by the platform), or the dev server runs in the background | empty `SITE_KEY` in `.env` and restart; or read `npx astro dev logs` |
| no new code when you sign up again with the same address | account emails to one address are limited, so a repeat within a few minutes sends none | use the code printed the first time (it stays valid for a while), wait a few minutes, or sign up with another address |
| `dev-admin` says `no account for …` | that address hasn't finished signing up in this database | sign up and type the code first |
| `dev-admin` says `refused (local development only)` | `SITE_KEY`, `SITE_PREVIEW` or `NODE_ENV=production` is set, or `DATABASE_URL` isn't on this computer | empty them in `.env` (it only ever changes a local database) |
| `DATABASE MISMATCH` when `npm run dev` or a `prisma` command starts | `DATABASE_URL` is set in your shell to another database than the one in `.env`; the dev server ignores the shell | to use that database, put it in `.env` and restart `npm run dev`; otherwise `unset DATABASE_URL` ([Which database each tool uses](#which-database-each-tool-uses)) |
| `npm run dev` says port 4321 is in use, or opens another port | another dev server is running | use the address it prints, or stop the other one (`npx astro dev stop`) |
| http://localhost:4321 shows a different project, or sign-up says "This form has expired" | another app already listens on 127.0.0.1:4321, so this one only got the IPv6 address (`[::1]:4321`) and your browser reaches the other app | stop the other app, or run this one on a free port: `npx astro dev stop && npx astro dev --port 4322` |
| the dashboard shows nothing for admins after `dev-admin` | the page was open before | reload `/dashboard/` |

## FAQ

**Can I be the owner on my computer?** No. The owner is only ever the account's owner on the
platform, through "View as admin". Locally you are an admin, which covers everything but editing
roles.

**Do I need a Site Key?** No. Without one the site runs in local development mode. Never copy a
hosted site's Site Key to your computer.

**Can I use another database?** Postgres only (any Postgres 15+). `DATABASE_URL` takes any
Postgres connection string.

**Where do emails go on my computer?** Nowhere: they are printed where `npm run dev` runs.

**How do I start over?** `docker compose down -v`, `docker compose up -d --wait db`,
`npm run setup`.

**What licence are the fonts under?** The theme fonts in `public/fonts/` are redistributed
under the SIL Open Font License 1.1: `public/fonts/OFL.txt` (served at `/fonts/OFL.txt`) has
each family's copyright line and the licence text. Adding or replacing a font: add its family,
files and copyright line there (`tests/intelform/font-licences.test.ts` checks every file).

**Can I deploy it somewhere else?** It is built to run on the platform it came from (one Worker,
its database, its emails); there is no other deploy config.

---

## On the platform

### Put it live

Pick **Astro app** when you create a site in the dashboard (or turn on "make it an app"), change what
you like in the editor (or ask your AI agent), then **Publish**.

**Enable the Site Database first.** This project ships migrations; a version with migrations is
refused until the site has a database. Only your account's owner can open the admin, with **View as
admin** in the dashboard. Anyone who signs up is a normal user, whatever email they use.

The platform sees `astro` and `@astrojs/cloudflare`, installs with `npm ci`, runs
`npm run build` (`prisma generate && astro build`), applies new migrations to your live database,
then deploys. If a migration fails, the previous version keeps serving.

### Accounts

- The **owner** is your account's owner, who opens the admin with **View as admin** in the dashboard or the
  editor. There's no owner sign-up, password or owner list. Owners and admins manage users at `/dashboard/users` and roles at `/dashboard/roles`.
- Teammates sign up like anyone else; an admin then gives them the **Editor** or **Viewer** role
  ([permissions](#intelform)). People who only answer forms need no account.
- Confirmation and password-reset emails are sent by the platform on your site's behalf.
- Change how sign-up works in `src/server/auth-settings.ts`.

### Write a post

Add a Markdown file to `src/content/blog/` (`my-post.md` → `/blog/my-post/`) with a `title`,
`description` and `publishedAt` at the top (see `how-to-add-a-post.md` there), then Publish.

### What this site controls

| Address | Served by |
| --- | --- |
| `/`, `/forms/`, `/about/`, `/privacy/`, `/terms/`, `/blog/` | this site |
| `/f/<slug>` | this site (a public form; `?embed=1` or `?embed=popup` inside `embed.js`) |
| `/sitemap.xml`, `/robots.txt`, `/rss.xml` | this site (search engines, feed readers) |
| `/account/login`, `/account/register`, `/account/forgot`, … | this site (sign-in) |
| `/dashboard/…` | this site (the dashboard) |
| `/site-api/…` | this site (your API) |
| `/api/…` | the platform |

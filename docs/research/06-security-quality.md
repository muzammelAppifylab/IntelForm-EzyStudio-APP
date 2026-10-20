# Research: security review, testing and quality

Checked 2026-10-19. Part A reviews the code written during setup. A probe against the real app confirmed A4 and A5 and the CSRF behaviour. Feeds [PLAN.md](../PLAN.md) phase 0 and the quality gates.

## Part A: findings in the current code

| # | Severity | Where | Problem | Fix | Status |
|---|---|---|---|---|---|
| A1 | **High** | `server/lib/session.ts` `clientIp` | Trusts the **leftmost** `X-Forwarded-For`, which the client controls. Anyone can rotate it to get past the login and forgot limiters, and every fake IP grows the in-memory map. | `TRUSTED_PROXY_HOPS` env (default 0). Take the entry that many hops from the right. With 0, use the socket address (`getConnInfo`). | Open |
| A2 | Medium | `server/routes/auth.ts` | The login limit is keyed only on IP + email, so a distributed attack gets 10 tries per IP. Counts live in memory and reset on restart. | A per-email limiter with backoff, plus a per-IP limiter. Move counters to Postgres. | Open |
| A3 | Medium | auth reset, invite accept, setup | argon2 (about 19 MiB, 50–100 ms) runs **before** the cheap token or "already set up" check, with no rate limit. That's a memory and CPU exhaustion vector. | Check first, hash second (re-check inside the transaction). Rate-limit these routes. Cap concurrent hashing at about 4. | Open |
| A4 | Medium | `server/index.ts` | Security headers apply only to `/api`. HTML pages have no X-Frame-Options or CSP, so the dashboard can be framed (clickjacking "Transfer ownership"). | Per-surface header middleware (B1). | Open |
| A5 | Low–Medium | `server/index.ts` | Unknown `/api/*` paths fell through to the HTML app with a 200. | Catch `/api/*` and return a JSON 404. | **Fixed** |
| A6 | Low | `server/index.ts` | No cache headers on HTML or assets. | Assets: immutable for a year, missing assets return 404 (**fixed**). `index.html` should also get `Cache-Control: no-cache`. | Partly fixed |
| A7 | Low | `auth.ts` forgot / reset | A known email takes longer (it inserts and awaits the email), which allows account enumeration by timing. Old reset links stay valid after a new one is issued or the password changes. | Send email through the jobs table, not awaited. Invalidate open resets on every password change and on each new request. | Open |
| A8 | Low | `session.ts`, `env.ts` | The cookie's `Secure` flag depends on `NODE_ENV`, and `APP_URL` silently defaults to localhost in production. | `secure` comes from `APP_URL` being https. `APP_URL` is required in production. Consider a `__Host-` cookie name. | Open |
| A9 | Low | `auth.ts` login | Logging in while an old cookie is present leaves that old session alive. | Delete the old session before starting the new one. | Open |
| A10 | Low | `validate.ts` | No request body size limit. | `bodyLimit` of 256 KB globally, larger on builder routes. | Open |
| A11 | Low | invites, me, team | A race on a unique index (`23505`) returns a 500. The transfer doesn't check that the demote step changed a row. | Map `23505` to 409. Use `RETURNING` on the demote. | Open |
| A12 | Low (privacy) | `session.ts` | `sessions.ip` stores the raw IP. | Store a hash, or drop the column. | Open |
| A13 | Info | `app.ts` | The cache and robots middleware runs after `csrf()`, so a CSRF 403 lacks `no-store`. | Register it first. | Open |

**Checked and sound:**
- **CSRF.** Hono's `csrf()` treats a missing content type as a form post and requires a same-origin `Sec-Fetch-Site` or Origin. Combined with SameSite=Lax, this is solid.
- **SQL** is parameterised everywhere.
- **One Owner** is guaranteed by a unique index, and setup takes an advisory lock.
- **Reset and invite tokens** are single-use (row lock), 256-bit, and stored as hashes.
- **Roles and status** are read on every request, so removal takes effect immediately.
- **Login timing** is equalised with a dummy hash.
- **The post-login redirect** only allows `/dashboard*`.

## Part B: recommendations

### B1. Security headers per surface (one middleware on the outer server)

- **Dashboard and auth pages:**
  - CSP: `default-src 'self'; script-src 'self' 'sha256-<theme script>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<bunny cdn>; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - Also `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS on https.
  - The inline theme script in `index.html` needs its hash computed at boot, or it moves to `/theme-init.js`. Radix and Sonner need inline styles.
- **Public form `/f/*`:**
  - The same policy, but with `frame-ancestors *` and no X-Frame-Options.
  - Add `https://challenges.cloudflare.com` to `script-src` and `frame-src` for Turnstile ([CF docs](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)).
  - Self-host theme fonts so respondents' IPs never go to Google.
- **API:** `secureHeaders()` plus `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.

### B2. Untrusted creator content

- **Render it as React text only.** Ban `dangerouslySetInnerHTML` with a lint rule. No markdown.
- **Shared `safeUrl` zod schema** for redirect, button and consent links. It accepts http(s) only, max 2048 characters, and renders with `rel="noopener noreferrer"`.
- **"Redirect with answers as parameters":**
  - Build it with `new URL()` + `searchParams.set`, never string concatenation.
  - Exclude signature answers.
  - Warn the creator that answers end up in the destination's logs.

### B3. Auth hardening

- **Login backoff.** Per-account exponential backoff after 5 failures (1, 2, 4 … 15 min cap). Return the same 429 whether or not the account exists.
- **Session tokens.** Rotate the token after password change, reset, invite accept and ownership transfer. Add "Sign out other devices".
- **Passwords.**
  - Optional breached-password check with the HIBP k-anonymity range API (`Add-Padding: true`), failing open on timeout.
  - Raise the minimum to 12, or keep 8 with HIBP ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)).
- **Setup.** The first visitor wins `/setup`. Consider an optional `SETUP_TOKEN` env for hosted installs.

### B4. Testing strategy

| Layer | Tool | Location |
|---|---|---|
| Unit | Vitest | `shared/**/*.test.ts` (validators, `can()`, definition, logic engine) |
| API integration | Vitest + real Postgres 17 + `app.request()` | `server/test/*.int.test.ts` |
| Components (later) | Vitest + jsdom | `src/**/*.test.tsx` |
| End to end | Playwright | `e2e/*.spec.ts` |
| Accessibility | `@axe-core/playwright` with WCAG 2.1 AA tags | inside e2e |
| Performance | Lighthouse CI + bundle budget | CI |

**Test database: a real Postgres** (docker compose locally, a `services: postgres` container in GitHub Actions).
- Migrate once into a template database, then give each worker `CREATE DATABASE wN TEMPLATE test_tpl`. Truncate between tests.
- Not PGlite: postgres.js needs a real wire protocol.
- Not Testcontainers: it adds weight for no gain here.

**Must-have API cases:**
- every route × every role (403s);
- the CSRF 403;
- owner uniqueness under concurrent transfers;
- reset and invite links are single-use;
- a removed member gets 401;
- the rate-limit 429.

**e2e flows:**
- setup → invite → accept;
- login, logout and reset (with console email captured);
- build → publish → submit, in each layout;
- an embed inside an iframe;
- axe on `/f/*` in all three layouts, plus login and the dashboard.

**CI sketch:**

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_PASSWORD: pg, POSTGRES_DB: intelform_test }
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 5s --health-retries 10
    env: { DATABASE_URL: postgres://postgres:pg@localhost:5432/intelform_test, APP_SECRET: ci-0123456789abcdef0123456789abcdef, NODE_ENV: test }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm run db:migrate && npm test
      - run: npm run build
      - run: npx playwright install --with-deps chromium && npx playwright test
```

### B5. Tooling

- **oxlint.** Keep it, and turn on its `jsx-a11y`, `import` and `vitest` plugins. Add `react/no-danger` as an error. Add `no-restricted-imports` so `server/` and `shared/` can't import `src/` or `react`.
- **Formatting and hooks.** Prettier (or oxfmt) as the formatter. `simple-git-hooks` + `lint-staged` on staged files only.
- **Typed client.** Keep shared response types plus the `api<T>()` helper. Hono RPC needs chained route definitions, doesn't type thrown errors, and slows the IDE as routes grow ([Hono RPC](https://hono.dev/docs/guides/rpc)).

### B6. Observability

- **Request ids and logs.** `hono/request-id` plus a pino child logger per request. Log method, path, status, duration, user id and role.
- **Redaction.** Hide passwords, tokens, cookies and authorization. Never log raw IPs.
- **Errors.** Put the request id in 500 responses so users can report it. Optional Sentry with `sendDefaultPii: false`.
- **Health.** `/api/health` with a database ping.

### B7. Performance in CI

- **Lighthouse CI** against `npm start` with a seeded form in each layout, mobile preset. Assert performance ≥ 0.9, accessibility ≥ 0.95, LCP < 2.5 s.
- **Bundle budget.** Fail the build if the `/f/*` entry plus its route chunks exceed about 120 KB gzip.

Sources: [Hono secure headers](https://hono.dev/middleware/builtin/secure-headers) · [OWASP redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) · [HIBP range API](https://haveibeenpwned.com/API/v3#PwnedPasswords) · [Playwright accessibility](https://playwright.dev/docs/accessibility-testing) · [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) · [oxlint rules](https://oxc.rs/docs/guide/usage/linter/rules.html)

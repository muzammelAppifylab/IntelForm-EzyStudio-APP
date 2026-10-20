# Research: backend, integrations and deployment

Checked 2026-10-19. Versions and licences come from `npm view`. Feeds [PLAN.md](../PLAN.md) phases 0, 5, 6 and 8.

## EzyStudio: almost nothing about the backend is public

Public pages describe EzyStudio as an AI no-code website builder from the EzyCourse company ("Ecommerce and Full-Stack Vibe Coding Platform"). It offers templates, blocks, a CMS, custom code and one-click publishing ([ezystudio.com](https://ezystudio.com/)). Its images come from `b-cdn.net`, which is Bunny.

We found nothing public about an apps marketplace, "API routes", the server runtime, Postgres, Bunny provisioning, or developer docs. **Every "EzyStudio API routes" assumption is unconfirmed.** Keeping the API as a portable Hono app on web-standard Request/Response is the right hedge. The questions to send them are at the end.

## Decisions

| Area | Choice (licence) | Runner-up | Risks |
|---|---|---|---|
| Image upload | **Proxy through our API**: `hono/body-limit` (5 MB), then a magic-byte check with **file-type 22.2.0** (MIT), then a server-side PUT to the Bunny Storage HTTP API with `AccessKey` and a SHA-256 `Checksum` | Bunny S3 presigned PUT | Bunny Edge Storage has **no presigned uploads** in its normal API. The S3 mode is a public preview for new zones only. Rename `/api/uploads/sign` to `/api/uploads`. |
| SVG logos | **DOMPurify 3.4.17** (MPL-2.0 or Apache-2.0) + **jsdom** (MIT), SVG profile, and **reject the file if anything was removed** | svgo (an optimizer, not a sanitizer) | jsdom is heavy, so load it only on upload. |
| Image delivery | Bunny Optimizer query params (`?width=&format=webp`) | Plain CDN | Optimizer is a paid add-on per zone; confirm EzyStudio enables it. |
| Email | **SMTP via nodemailer 10.1.7** (MIT-0) + **Resend over fetch** (no SDK). Optional Postmark. | Postmark | Many hosts block outbound SMTP ports; ask EzyStudio. |
| Background work | **Our own outbox table + in-process poller with `FOR UPDATE SKIP LOCKED`** (~150 lines) | pg-boss 12 (MIT) | pg-boss and graphile-worker bring `pg` alongside postgres.js. |
| Webhook signing | **Standard Webhooks** spec; receivers can verify with `standardwebhooks` (MIT) | Stripe-style `t=…,v1=…` | — |
| SSRF protection | **undici Agent** with `connect.lookup` that checks every resolved IP against a `node:net` BlockList (and connects to that same IP) | request-filtering-agent | Plain `http.Agent` filters don't apply to undici fetch ([OWASP](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs)). |
| CSV export | postgres.js `.cursor(500)` + Hono `stream()`, our own escaper | csv-stringify | A cursor holds one pool connection for the length of the export. |
| ZIP of CSVs | **archiver 8.0.0** (MIT, backpressure) | fflate (no backpressure) | — |
| Country from IP | A trusted proxy header first (`CF-IPCountry` or Bunny's equivalent), then **DB-IP Lite Country MMDB (CC BY 4.0)** via mmdb-lib (MIT) | MaxMind GeoLite2 with the Owner's own key | DB-IP needs a visible "IP Geolocation by DB-IP" credit. **Reject ip-api**: non-commercial only, and it sends raw IPs to a third party. |
| Browser / device | **bowser 2.14.1** (MIT) + `Sec-CH-UA-*` client hints | ua-parser-js **1.0.41 pinned** (MIT) | **ua-parser-js 2.x is AGPL-3.0.** |
| Rate limiting | **Postgres UNLOGGED table**, fixed window, one upsert per check | rate-limiter-flexible (ISC) | UNLOGGED loses its counts on crash, which is fine. |
| Logging | **pino 10.4.0** (MIT) with redaction | console | — |
| Error tracking | Optional **@sentry/node** (MIT), on when `SENTRY_DSN` is set | none | — |

## Outbox and scheduled jobs

The design works in one process, survives restarts, and is safe with several instances.

```sql
CREATE TABLE jobs (
  id bigserial PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 3,
  locked_until timestamptz, last_error text, done_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE done_at IS NULL;
```

- **Submit writes its jobs in the same transaction** as the response (`notify_owner`, `confirm_respondent`, `webhook`). A crash after commit loses nothing.
- **When jobs run.**
  - After commit, `queueMicrotask(drain)` starts delivery at once without blocking the reply.
  - A `setInterval(drain, 5000).unref()` picks up anything left after a restart.
- **drain** claims a batch, runs handlers with a concurrency of 4, then sets `done_at` (or `last_error` and a backoff `run_at`):

  ```sql
  UPDATE jobs SET locked_until = now() + interval '2 min', attempts = attempts + 1
  WHERE id IN (SELECT id FROM jobs
               WHERE done_at IS NULL AND run_at <= now()
                 AND (locked_until IS NULL OR locked_until < now()) AND attempts < max_attempts
               ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 10)
  RETURNING *
  ```
- **Attempts.** Email gets 3 tries. Webhooks get **1**, because automatic retries are out of scope in the PRD. Manual Resend exists.
- **Scheduled ticks** use a lease row in `scheduler(name, next_run_at)`, so only one instance wins each tick:
  - Every hour:
    - retention delete in batches of 1,000;
    - trim `webhook_deliveries` to 100 per form;
    - purge old rate-limit rows, expired sessions, invites and resets, and finished jobs older than 7 days.
  - Every minute: flip the stored status of forms past their close date.
- **Close-on-date needs no job for correctness.** The public GET and submit both check `close_at <= now()`.
- **Shutdown on SIGTERM:** stop the timers, wait up to 10 s for jobs in flight, close the server, then `sql.end({ timeout: 5 })`.

## Webhook signing (Standard Webhooks)

- **Secret:** `whsec_` + base64 of 32 random bytes, per form. It's stored encrypted, shown once, and can be regenerated.
- **Headers:**
  - `webhook-id: msg_<responseId>`, unchanged on Resend so receivers can dedupe. Tests use `msg_test_<uuid>`.
  - `webhook-timestamp`: Unix seconds.
  - `webhook-signature: v1,<base64 HMAC-SHA256(key, id + "." + timestamp + "." + body)>`. Several space-separated signatures allow rotation.
  - `Content-Type: application/json` and `User-Agent: IntelForm-Webhooks/1`.
- **Request rules:**
  - Custom headers can't override Host, Content-Length, Content-Type or `webhook-*`.
  - 10 s timeout; redirects are not followed (a 3xx counts as failure).
  - Read at most 1 KB of the reply. Success means a 2xx status.
- **SSRF:**
  - Allow only http(s) URLs.
  - Resolve every address and reject:
    - loopback and 0.0.0.0/8;
    - 10/8, 172.16/12, 192.168/16;
    - 100.64/10;
    - 169.254/16 (cloud metadata);
    - 198.18/15, multicast;
    - ::1, fc00::/7, fe80::/10;
    - IPv4-mapped IPv6.
  - Validate inside the connection lookup, which defeats DNS rebinding.
  - A development-only flag allows localhost.
- **Delivery log:** time, webhook id, URL, status, duration, the first 1 KB of the reply, the error, `is_test` and a payload snapshot. Resend sends the stored payload again with the same id and a fresh signature.

## Upload flow

1. **Upload request.** The browser POSTs multipart to `/api/uploads?purpose=logo|favicon|image|og`. It needs a signed-in Owner or Editor and passes the CSRF check.
2. **Size and type.** 5 MB limit. `file-type` sniffs the bytes and allows only png, jpeg, webp, gif and svg (svg for logos only). The client's type and extension are never trusted.
3. **SVG.** Parse it, sanitise it, and reject it if anything changed. Serve it with `image/svg+xml`.
4. **Store on Bunny.** PUT to `https://{region}.storage.bunnycdn.com/{zone}/intelform/{uuid}.{ext}` with `AccessKey` and the SHA-256 checksum. Save the CDN URL, and request variants with `?width=…&format=webp`.
5. **Test upload.** "Test upload" in Settings writes and deletes a 1-byte file.

Bunny credentials never reach the browser. **Signatures** are drawn on a canvas and sent as PNG inside the submit request; the server uploads them the same way.

## Email interface

```ts
interface EmailMessage { to: string[]; subject: string; text: string; html?: string; replyTo?: string }
interface EmailDriver { send(m: EmailMessage & { from: string }): Promise<{ id?: string }>; verify(): Promise<void> }
type EmailConfig =
  | { driver: 'none' } | { driver: 'console' }
  | { driver: 'smtp'; host: string; port: number; secure: boolean; user: string; pass: string /* encrypted */ }
  | { driver: 'resend'; apiKey: string } | { driver: 'postmark'; serverToken: string }
```

- **Where config lives.** It's stored in `app_settings`, with secrets decrypted only on the server and cached until changed. `EMAIL_DRIVER=console` stays as a development override.
- **Test from Settings.** "Send test email" calls `verify()`, then sends to the Owner.
- **Delivery.** Every send goes through `jobs`, never inline. SMTP also covers SES, Mailgun, Brevo, Postmark and Resend.
- **Free tiers.**
  - Resend: 3k a month, max 100 a day.
  - Postmark: 100 a month; $15 for 10k.
  - SES: about $0.10 per 1k, but needs the AWS console.
  - Mailgun: 100 a day.
  - Brevo: about 300 a day.
- **Owner DNS checklist** for the README:
  - verify the sending domain;
  - add DKIM records;
  - one SPF record with the provider's `include:`;
  - DMARC starting at `p=none`;
  - send from a subdomain such as `mail.example.com`;
  - From must be on the verified domain, with Reply-To for the respondent.

## CSV export

- **Response headers:** `text/csv; charset=utf-8` and `Content-Disposition` with `filename*=UTF-8''…`.
- **Excel compatibility:** UTF-8 BOM, CRLF line endings, quotes around fields containing `," \r \n`.
- **Formula injection:**
  - Prefix text cells that start with `= + - @ \t \r` with `'` (OWASP).
  - Don't prefix numeric columns, so negative numbers stay numbers.
- **Streaming.** `await stream.write()` for backpressure, and stop the cursor loop when the client disconnects.
- **ZIP of all forms:** archiver, one CSV entry per form.

## Rate limits, sessions, secrets

- **Rate limit:**

  ```sql
  INSERT INTO rate_limits (key, window_start, count) VALUES ($1, date_bin('1 min', now(), 'epoch'), 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count
  ```
- **Sessions** are already in Postgres. Extend expiry at most once an hour per session.
- **Secrets:**
  - Move to the format `v2.<kid>.iv.tag.data`, with `APP_SECRET_PREVIOUS` for rotation.
  - Derive separate keys with HKDF (`secrets`, `ip-hash`).
  - The README must warn that losing `APP_SECRET` makes stored secrets unrecoverable.

## Packaging

- **Image.** Multi-stage Dockerfile on `node:24-slim` (Node 24 is the current LTS). Use glibc, not Alpine, because argon2 ships prebuilt binaries. Run as a non-root user.
- **Health.** `GET /api/health` (alive) and `GET /api/ready` (`select 1`).
- **Migrations on boot**, behind a lock so parallel instances don't collide.
- **Config and logs.** Validate env with zod and fail fast (done). pino JSON to stdout, redacting cookies, authorization and passwords. Sentry is optional.

## Questions for EzyStudio

1. **Runtime.** What are "API routes" exactly: Node version, edge or serverless, request time limit, max body size? Long-running process or one function per request?
2. **Background work.** Is response streaming supported (CSV and ZIP export)? Can work continue after the reply (`waitUntil`, or a persistent process for the job poller)? Is there any cron?
3. **Instances.** How many run, and is memory shared?
4. **Postgres.** Is there one per install? Which version, connection limits and pooler? PgBouncer in transaction mode breaks advisory locks. Backups? Do we run migrations ourselves?
5. **Bunny.** How are credentials provided (env names)? Region? Is S3 mode enabled? Is Optimizer enabled? Pull zone hostname?
6. **Proxy.** Which proxy or CDN sits in front of the app, and which client IP and country headers can we trust (and how many hops)?
7. **Outbound traffic.** Is outbound SMTP (587/465) allowed? Are outbound HTTP calls to any host allowed (for webhooks)?
8. **Operations.** How are env and secrets set per install? Where do logs go? Is there a health-check path convention? Is a Dockerfile or build command required?
9. **Headers.** Can `/f/*` set its own `frame-ancestors` CSP header?
10. **Licence.** What licence does the template ship under? It affects CC-BY credit and AGPL obligations.

## Licence red flags

- **ua-parser-js 2.x is AGPL-3.0.** Use bowser, or pin 1.0.41.
- **DB-IP Lite (CC BY 4.0)** needs a visible credit link.
- **MaxMind GeoLite2** needs an account, a key per install and attribution. Don't bundle it.
- **ip-api's free tier** is non-commercial only.
- **`@getbrevo/brevo`** lists no licence; use SMTP instead.
- **DOMPurify** (MPL-2.0 or Apache-2.0) is fine. Everything else is MIT, MIT-0, ISC or Apache-2.0.

Sources: [Bunny S3](https://bunny.net/docs/storage/s3) · [Bunny HTTP API](https://docs.bunny.net/storage/http) · [Bunny Optimizer](https://bunny.net/docs/optimizer/dynamic-images) · [OWASP SSRF in Node](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs) · [OWASP CSV injection](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Injection_Testing/21-Testing_for_CSV_Injection) · [ua-parser-js licence change](https://blog.logrocket.com/user-agent-detection-ua-parser-js-license-change) · [DB-IP Lite](https://db-ip.com/db/lite.php) · [GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula)

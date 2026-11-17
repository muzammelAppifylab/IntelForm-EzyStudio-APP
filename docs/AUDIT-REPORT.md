# IntelForm audit report: EzyStudio migration

Branch `ezystudio-migration`, commit `082c731` ("Remove legacy sources; README and store checks"), template astro-app 0.10.22.
Audit date 2026-11-17. This was an independent audit by nine areas: requirements, API, security, data and concurrency, operations, performance, frontend and accessibility, code quality, and privacy and legal. A baseline step and a map step came first, and a separate verification pass followed.
Machine-readable findings: [docs/audit/findings.json](audit/findings.json). Evidence: [C:/Users/Appifylab/intelform-audit-evidence/](audit/evidence/). Each area folder has a README.md with the exact commands to re-run its checks.

How to read the labels:
- **Confirmed** means the problem was reproduced, either live or with a proof test.
- **Likely** means it was found by tracing the code and could not be reproduced. The reason is given in each case.
- Every Critical and High finding was re-checked by an independent verifier. The result appears under "Verification" in each row; V↓/V↑ marks a severity the verifier changed.

---

## 1. Verdict

**NOT READY TO SHIP. Ship after wave 1 and wave 2 below. No Critical issues were found.**

In plain words, here is why:

1. **Embedded forms don't work at all.** A customer can put a form on their own website with the inline or popup code from the Share tab. Every visitor who presses Submit there is told "This form has expired". Their answers are thrown away. Reloading doesn't help (F-001). Forms opened through their direct link work fine.
2. **Emails you switched on are quietly not sent.** On a normal hosted site, respondents never get the confirmation email and ticked teammates never get notified. Meanwhile the settings screen says "Emails are on, no mail server to set up" (F-003). Under load, the owner's own notification emails and webhook deliveries can also be dropped without any trace (F-002, F-004, F-012).
3. **Some answers can't be submitted, and some get saved twice.** Long answers in non-Latin scripts are refused (F-005). A retry on a bad mobile connection saves the response twice and sends the emails twice (F-007). Two people pressing Publish at the same moment break the form for people who are part-way through it (F-008).
4. **Privacy promises are not fully kept.** An erased person's data stays downloadable in earlier exports for a day (F-010). Nothing records who deleted or exported data (F-011). Built-in templates ask people to agree to a privacy policy that doesn't exist (F-014). The "anonymous" survey stores a value that can identify staff members (F-015).
5. **The store gate is red, and the release checks are weak.** `node store-check.mjs` fails because the template is behind. That is not a code defect (see below). The documented check also skips all 175 database tests (F-021) and has no typecheck (F-022). There is no browser test for the respondent form, which is how the embed failure slipped through (F-023).

**Release blocker, not a code defect.** `node store-check.mjs` fails with "Current template release: Your template is 0.10.22; the current one is 0.10.24. Merge it before you submit". It was re-run for this report on 2026-11-17. The orchestrator brief recorded the message as "current one is 0.10.23", and the baseline recorded 0.10.24. According to the brief, GitHub only publishes 0.10.22 so far. **Merge the template upgrade as soon as it is published.** When you do, follow F-020 first, otherwise the test suite turns red.

That same re-run also flagged a second FAIL that this audit caused: "Shell scripts and native programs" for `C:/Users/Appifylab/intelform-audit-evidence/code-quality/scripts/simulate-template-tests-upgrade.sh`. The `docs/audit/` evidence folder (which also holds `privacy-legal/lib.sh`) must be removed from the submission, or converted to `.mjs`, before you submit.

**Counts of kept findings, after verification:** Critical 0, High 4, Medium 21, Low 33. That is 58 in total, merged from 64 area findings plus 9 baseline findings.

---

## 2. Top risks

**R1. Embedded collection is completely broken (F-001, High, Confirmed 6 times including on a production build).**
The global CSRF guard requires a SameSite=Lax cookie. Browsers never store that cookie inside an iframe on another site. As a result, every anonymous respondent write from an embed is refused with 403:
- the submit itself
- funnel events
- password unlock
- signature uploads

The respondent sees a misleading "expired" message. The creator sees no error at all, only fewer responses. Embedding is an advertised channel and a legacy definition-of-done item. The fix is small and app-owned: mount the anonymous respondent routes before `csrf`, as `/checkout` already is. The test gap that hid it (F-023) has to close with it.

**R2. Messages and jobs that run after a submit are fire-and-forget (F-002, F-003, F-004, F-012; systemic S2).**
After the response row commits, everything else depends on a single `sendJob` call and a single relay call, and their outcomes are discarded. Those are:
- the owner email
- the respondent confirmation
- teammate emails
- the first webhook attempt, and its retries

The defaults make this worse. The platform accepts 10 jobs a minute for the whole site, the owner relay is capped at 5 emails per recipient per hour, and most sites have no mail provider. Under those conditions, these messages are lost under normal traffic, with only a `console.warn` as a trace. Meanwhile the dashboard says email is on and needs no setup. The fix is an outbox row written in the submit statement, plus a digest for owner emails and honest capability flags.

**R3. Missing unique keys on repeatable writes (F-007, F-008, F-013, F-034; systemic S4).**
These write paths have no unique key:
- the submit path
- the publish path in the UI
- the one-per-browser setting

Retries and double clicks therefore create duplicate responses, duplicate emails and webhooks, or duplicate versions. A duplicate version makes in-progress respondents fail with 409. The one-per-email race answers 500 instead of 422. AGENTS.md explicitly requires a unique key for anything a person may repeat.

**R4. Personal-data promises: erasure, consent, minimisation and accountability (F-010, F-011, F-014, F-015, F-016, F-029; systemics S3, S5, S7).**
- Erase and retention do not reach ready exports, which stay downloadable for up to 24 h, or the caches.
- Templates ask for consent to a policy that is empty.
- An unused `ip_hash` can be joined to staff login records.
- Bulk deletes and exports leave no audit event.
- There is no per-person export.

Each is moderate on its own. Together they mean the privacy story is not yet defensible to a customer or a regulator.

**R5. The release gate can't be trusted (F-020, F-021, F-022, F-023, F-048, F-009; systemic S8).**
- `npm run check` goes green without running any of the 175 integration tests.
- There is no typecheck (`astro check` shows 4 errors), no linter and no E2E test.
- Coverage runs crash a worker about half the time.
- The required template upgrade will silently overwrite 5 app-edited test files.
- One migration is not transactional, so a failed deploy leaves the live database half-migrated.

---

## 3. Baseline results

Source: [C:/Users/Appifylab/intelform-audit-evidence/baseline/baseline.md](audit/evidence/baseline/baseline.md), with logs in `baseline/logs/`. The baseline ran from a detached worktree of `082c731` against its own databases `audit_baseline` and `audit_baseline_test` (14 migrations, `prisma/seed.sql`). Node v24.15.0 on Windows 11.

| # | Check | Command | Status | Counts / notable |
|---|---|---|---|---|
| 1 | Install | `npm ci` | PASS (23 s) | 443 packages, 2 moderate vulnerabilities. 2 install scripts were blocked: workerd (allowScripts pins an older version) and free-email-domains (network postinstall) → F-053 |
| 2a | Typecheck, fresh clone | `npx tsc --noEmit -p .` | **FAIL** (exit 2) | 38 errors, all caused by the missing `.astro/types.d.ts` |
| 2b | Typecheck after `npx astro sync` | `npx tsc --noEmit -p .` | PASS | 0 errors |
| 2c | astro check as installed | `npx astro check` | false PASS | Checks nothing (it prompts to install @astrojs/check) |
| 2d | astro check with @astrojs/check@0.9.12 | `npx astro check` | **FAIL** (exit 1) | 592 files, **4 errors**: TS2345 `Astro.csp` vs `CspApi`, from the template-owned `src/platform/files.ts:127`. 63 hints → F-022 |
| 3 | Lint | none configured | n/a | Informational oxlint 1.88.0: 41 warnings, 0 errors → F-054 |
| 4a | Tests + coverage, run 1 | `TEST_DATABASE_URL=… npx vitest run --coverage` | **FAIL** (exit 1) | 81 passed / 2 skipped files. Worker crash dropped builder-api.test.ts → F-048 |
| 4b | Tests + coverage, run 2 | same | PASS | 82 files, 1622 passed / 6 skipped. Lines 56.1 %, branches 45.4 %. Portal 20.9 %, respondent client 19.2 % → F-023 |
| 4c | Tests, no coverage | `TEST_DATABASE_URL=… npx vitest run` | PASS (254 s) | 1622 passed / 6 skipped |
| 4d | Opt-in SQL tests | `BUILDER_SQL_CHECK=1 RESPONSES_SQL_DATABASE_URL=… npx vitest run …` | PASS | 6 tests |
| 5 | Build | `npm run build` | PASS (74 s) | Server bundle 2.2 MB gz. 1 warning: `node:crypto` is externalized for the browser → F-058 |
| 6a | npm audit | `npm audit` | **FAIL** (exit 1) | 2 moderate (hono 4.13.13, astro 7.3.8) → F-024 |
| 6b | Outdated | `npm outdated` | info | 15 packages behind |
| 6c | Abandoned dependencies | `node scripts/dep-age.mjs` | PASS | none |
| 6d | Licenses | license-checker | PASS | Direct dependencies are MIT/Apache-2.0. No copyleft in the Worker bundle. Fonts: F-057 |
| 7 | Install scripts | package.json, lockfile | NOTE | → F-053 |
| 8a-c | Secrets (history and tree) | gitleaks v8.24.3 + regex scan | PASS | 32/26 hits, all test fixtures or hashes. `.env` was never committed |
| 9a | Store checks | `node store-check.mjs` | **FAIL** | "Current template release" (0.10.22 vs 0.10.24): the release blocker above. The npm audit inside store-check never runs on Windows → F-052. The 2026-11-17 re-run adds a FAIL for the audit's own `.sh` evidence file |
| 9b | Platform check | `npm run platform -- check` | **FAIL** (exit 10) | Same template-behind message. 72 template files untouched |
| 9c | Jobs config | `npm run platform -- jobs` | PASS | 7 lists, 2 schedules |
| 10 | Documented release gate | `npm run check` (no TEST_DATABASE_URL) | PASS, but hollow | **20 of 84 files and 175 tests skipped** (every integration test) → F-021 |

There is no CI, because the platform forbids `.github/workflows`. The documented gate is DEVELOPERS.md section 7. None of its steps runs a typecheck or a linter.

---

## 4. Findings

Findings are sorted by severity. Within a severity, Confirmed comes before Likely. No finding came back "Unconfirmed" from verification, so there is no such row. The one Unconfirmed sub-claim, relay-quota exhaustion, is noted inside F-004. The same data is in [findings.json](audit/findings.json), including the wave and the systemic issue for each finding.

| id | sev | area | title | location | evidence + verification | failure scenario | impact | recommended fix | regression test | effort | wave |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-001 | High | requirements, security, frontend-a11y | Embedded forms (inline iframe and popup on another site) can never be submitted: every write gets 403 csrf_failed | src/server/app.ts:68-77 (global .use(csrf) before .route('/public/forms') :111 and '/uploads' :114); src/platform/guards.ts:114; src/platform/auth/cookies.ts:73 (SameSite=Lax); src/platform/browser.ts:84-114; src/respondent/api.ts:53,81; src/respondent/upload.ts:56; public/embed.js | **Confirmed.** Reproduced 6 times (3 areas + 3 verifiers), including against a production build (astro build + preview, security and frontend-a11y areas). Control (form opened directly): events 204, responses 200, row stored. Embedded on http://127.0.0.1:<port> (a different site): no site_csrf cookie stored or visible in the frame, POST /events 403 x2, POST /responses 403 {"error":"csrf_failed","message":"This form has expired. Reload the page and try again."}, no row written; reload gives the same. Same-site embed works (frontend-a11y samesite.mjs). Scripts/logs: C:/Users/Appifylab/intelform-audit-evidence/requirements/embed-submit.mjs+.log, C:/Users/Appifylab/intelform-audit-evidence/security/embed-csrf.mjs, C:/Users/Appifylab/intelform-audit-evidence/frontend-a11y/scripts/embed.mjs + logs/embed-cross-site.txt + shots/embed-cross-site-submit.png, C:/Users/Appifylab/intelform-audit-evidence/verify/v4/ (COMMANDS.txt), v6/, v8/. <br>_Verification:_ Confirmed High by 3 independent verifiers (v4, v6, v8): real Chrome, host page on a second site, inline and popup | A creator pastes the inline or popup embed code from the Share tab into their own website. A visitor fills every answer and presses Submit. The browser never stored the SameSite=Lax CSRF cookie inside the third-party frame, so the POST carries no x-csrf-token; the server answers 403 and the visitor reads "This form has expired. Reload the page". Reloading cannot help. View/start funnel events and signature uploads fail the same way. | 100% of embedded submissions are lost on every embedding site in Chrome, Firefox and Safari while the creator believes the form is live. Embedding is an advertised channel (README.md:16-17, Share tab, public/embed.js) and a legacy DoD item (legacy/docs/PLAN.md "embed works in an iframe"). Direct /f/<slug>/ links still work (workaround), so not Critical. | In src/server/app.ts mount publicFormsRoutes and the anonymous POST /uploads/signature AFTER sameOrigin and BEFORE .use(csrf), the way /checkout is mounted (a fetch from inside the frame to its own origin is Sec-Fetch-Site: same-origin, so sameOrigin still refuses cross-site callers). These routes carry no session, so double-submit CSRF protects nothing; abuse is already covered by the signed render token, honeypot, Turnstile and rate limits. Make src/respondent/api.ts and upload.ts call fetch directly (credentials:'omit') instead of siteFetch so they never request /auth/csrf. Correct the comment at app.ts:105-110. Do not edit src/platform. | Playwright E2E against astro build + preview: host page on 127.0.0.1 embeds /f/<slug>/?embed=1 (and the embed.js popup), fill + submit, expect the end screen and a new responses row; repeat with a signature field. Integration test: POST /site-api/public/forms/:slug/responses with Sec-Fetch-Site: same-origin and no CSRF cookie is not refused with csrf_failed; a signed-in route without the cookie still is. | M | W1 |
| F-002 | High | ops | A refused or failed job send after submit drops the response's owner notification, confirmation and webhook for good, while the respondent is told it was saved | src/server/intelform/notify/notify.ts:80-93 (queueResponseJobs catches, console.warn, returns false); src/server/intelform/respondent/submit.ts:276-284 (called after commit, result ignored); no outbox table; src/server/background.ts hourlyMaintenance has no catch-up | **Confirmed.** Hosted-mode proof through the real Site API app on audit_ops with a fake platform enforcing the documented 10 jobs/min (docs/agent/background-jobs.md:143): 15 submits from 15 IPs all got 200 and 15 rows saved, only 10 notify jobs accepted; the other 5 left only "[intelform] notify job not sent for a response (E_JOBS_RATE_LIMITED)" (C:/Users/Appifylab/intelform-audit-evidence/ops/job-loss.proof.test.ts, job-loss.result.json). Verifier v2: C:/Users/Appifylab/intelform-audit-evidence/verify/v2/queue-response-jobs-drop.test.ts, 3/3 pass (send called once, no throw, returns false). The same 10/min budget is shared with export parts, file cleanup, webhook test/resend and retention continuations. <br>_Verification:_ Confirmed High (v2: unit proof of queueResponseJobs for E_JOBS_RATE_LIMITED / E_JOBS_UNREACHABLE / E_JOBS_PAUSED; live platform 429 not reproducible locally) | A form with notifications or a webhook gets its 11th response within a minute (newsletter burst, or an admin running an export/delete at the same time). sendJob gets 429. The respondent sees "Thanks! Your response has been recorded"; the owner gets no email, the respondent no confirmation, the CRM webhook never fires, and nothing ever retries. Same on E_JOBS_UNREACHABLE (8 s timeout) or a Worker dying between commit and send. | Silent loss of messages/jobs on the busiest forms; webhook receivers lose records with no trace in the delivery log. Breaks docs/agent/background-jobs.md:54 and the legacy promise "nothing is lost on restart" (legacy/README.md:133). Response data itself is kept, so not Critical. | Add an intelform_outbox(response_id, created_at) row written in the same submit CTE as the INSERT (additive migration). After commit send notify-<id> and delete the row when accepted; hourly maintenance re-sends rows older than ~2 min with the same key (idempotent). Optionally batch with sendJobs and ask the owner to raise the per-minute limit. | Integration (hosted mode, fake platform answering 429 to /jobs): submit 1 response, assert an outbox row; run hourlyMaintenance with the platform answering 201, assert job notify-<id> sent and outbox row gone. | M | W1 |
| F-003 | High | requirements, privacy-legal | Respondent confirmations and teammate notifications are silently never sent without an owner mail-provider secret, while the dashboard says email is on and needs no setup; the owner email has no answers although the switch says it does | src/server/intelform/notify/notify.ts:288-298 (teammates only when deps.mail), :348 (if (!mail) return 'no-provider'), :102-104 (relay payload {kind,path} only); src/server/background.ts:43 (outcome discarded); src/server/routes/builder.ts:129 and src/server/intelform/settings/settings.ts:105 (emailEnabled = siteKey \|\| localDev); mailProviderConfigured() has no caller (notify/index.ts:5-9); src/portal/intelform/settings/delivery.tsx:88,94; src/portal/intelform/builder/settings/sections.tsx:385-425 (incl. :398/:403 "Includes every answer") | **Confirmed.** Live (requirements flows4.mjs, flows4.log, flows4-serverlog.txt; privacy-legal README P3): GET /builder/capabilities {"emailEnabled":true}; form with notifyOnResponse, two ticked teammates and confirmationEmail; submit 200; server log has only "notification -> (the site owner)" with a link and no answers; no confirmation, no teammate email, no warning. v5: C:/Users/Appifylab/intelform-audit-evidence/verify/v5/notify.proof.test.ts asserted mailProviderConfigured()=false, confirmation='no-provider', notified='owner', teamEmails=0, 1 relay call, 0 console.warn, job succeeds. v1: C:/Users/Appifylab/intelform-audit-evidence/verify/v1/confirm-no-provider.test.ts (run-output.txt) same with emailEnabled()===true. <br>_Verification:_ Confirmed High by 2 verifiers (v5: real runResponseNotify on audit_v5; v1: proof test with Site Key set and no provider) | Default hosted site (Site Key, no Resend/Postmark key). The creator turns on "Send a confirmation to the respondent" and ticks two teammates; Settings > Delivery says there is "no mail server to set up" and "Emails are on". Every respondent gets nothing, teammates get nothing, the owner gets a link-only email (switch promised every answer). No screen, job result or log says so. | Silent loss of every confirmation and teammate notification on default installs; the in-app copy contradicts README.md:95-99. No data lost, the owner still gets a link, so High not Critical. | Return mailConfigured: mailProviderConfigured() (separately from relay availability) from GET /builder/capabilities and app-settings; disable or warn on the confirmation switch and the teammate list when false. Rewrite delivery.tsx:88/94 and sections.tsx:398/403/406 to say what is really sent (owner: link via platform; confirmations/teammates: need a provider). Record the 'no-provider' outcome in the job result (Jobs tab) and print skipped confirmations in local dev as README promises. Remove description={m.email} drift separately (F-030). | Route test: no provider secret => capabilities.mailConfigured=false. Portal test: the confirmation switch shows the warning when false. Notify job test: confirmation 'no-provider' is surfaced in the job result, not swallowed. Unit test of relay payload shape vs switch copy. | M | W1 |
| F-004 | High | ops | Owner notifications sent through the platform relay are dropped silently when the relay answers 429 (5 per recipient per hour); job counts as success and never retries | src/server/intelform/notify/notify.ts:102-120 (relayToOwner: 401/422/429 -> 'refused', no throw), :287-296, :333 (still reports 'owner'); src/server/background.ts:42-44; limits STORE-LISTING.md:34-36, docs/agent/auth.md:133-136 | **Confirmed.** ops job-loss.proof.test.ts case relay429: runResponseNotify resolved {notified:'owner'}, 1 relay call, 0 done markers, no throw. v3: C:/Users/Appifylab/intelform-audit-evidence/verify/v3/relay-429.proof.test.ts (run log relay-429.run.log), 3/3 pass; only trace is console.warn "owner notification: the platform answered 429". Re-run: npx vitest run --config C:/Users/Appifylab/intelform-audit-evidence/verify/v3/relay-429.vitest.config.ts <br>_Verification:_ Confirmed High for the app-side drop (v3: real relayToOwner/runResponseNotify with fetch stubbed to 429). Platform applying the 5/recipient/h cap to kind 'notification' is Likely (documented, not observable locally). Sub-claim that respondents can exhaust the site quota for sign-in codes is Unconfirmed (depends on whether refused sends count). | Notifications on, no provider (every notification, including ones meant for ticked teammates, goes to the one owner address). From about the 6th response in an hour the relay answers 429; the owner never hears about those responses, and the dashboard shows nothing. | Silent loss of owner notifications under normal traffic (10 submits/min/IP/form is allowed). Possible (Unconfirmed) knock-on: site-wide relay quota shared with sign-in codes and password resets. | Digest instead of one relay email per response: at most one "N new responses on <form>" per form per 15-30 min (hitWindow). Treat 429 as retryable with delay or record a pending digest; never report 'owner' when refused. Keep owner relay traffic below a fixed share of the 120/h site quota. | Unit: relay fake answers 429 => runResponseNotify throws (retry) or records a pending digest, never resolves notified:'owner'. 50 responses in 10 min => 1 relay email. | M | W1 |
| F-005 | Medium | requirements, api, ops | Valid submissions over 64 KB are refused with 413 although submit promises 256 KB of answers (non-Latin long answers cannot be sent) | src/server/app.ts:27-33,74-77 (global bodyLimit 64 KB; only PATCH /forms/:id gets 512 KB) vs src/server/intelform/respondent/submit.ts:23,44,81-86 (MAX_ANSWERS_BYTES 256 KB unreachable); src/respondent/api.ts:47-58 (generic message) | **Confirmed.** requirements flows3.mjs/flows3.log: 3 x 8,000 CJK chars (72,037 B, each within the 10,000-char limit) => 413 {"error":"too_large"}; 63 KB => 200. api respondent.mjs section 1 (respondent.out): 3 x 10k CJK (90,037 B) => 413 in 54 ms. ops big-submit.log: 70 KB => 413. <br>_Verification:_ Not independently verified (Medium); reproduced live by 3 areas | A respondent writing Chinese, Japanese, Bengali or Arabic fills three long-text questions within each field's limit; Submit shows "That request is too large." with no field named; retries fail the same way. | Responses that pass validation cannot be saved for a real group of respondents; creator never learns. Workaround: shorten answers. | Give POST /site-api/public/forms/:slug/responses its own bodyLimit (~320 KB) in app.ts like the autosave route; keep assertAnswerSize as the real check; map 413 in the respondent UI to "Shorten the longest answers". | Integration: 3 long_text answers of 10,000 "漢" (~90 KB) => 200 and one row; ~300 KB of answers => 413 payload_too_large. | S | W1 |
| F-006 | Medium | api, security | Anyone can lock every respondent out of a password-protected form for the rest of each hour (form-wide failure cap refuses the correct password); route calls verifyPassword itself | POST /site-api/public/forms/:slug/unlock: src/server/routes/public-forms.ts:31-35 (UNLOCK_FORM_FAILURE_LIMIT=100), :94-100 (form-wide rateLimit checked before verifyPassword at :96-97); rule docs/agent/security.md:169-170 | **Confirmed.** api misc.mjs unlock (misc.out) and security unlock-lockout.mjs (unlock-lockout.out.txt): 11 addresses x 10 wrong passwords => 100 x 422 then 10 x 429; a fresh address with the CORRECT password => 429 "This form has had too many wrong passwords. Try again later." until the end of the fixed hourly window (37 s of attacker time). <br>_Verification:_ Not independently verified (Medium); reproduced live by 2 areas | Someone runs a loop each hour sending ~100 wrong passwords from 10+ IPs; every real respondent typing the right password is refused for the rest of that hour, indefinitely. | Cheap, repeatable denial of service on any password-protected form; lost responses look like an outage to the creator. | Check the per-IP limit, then verify, and count only failures; never let the form-wide budget refuse a correct password (use backoff/Turnstile on the form-wide budget, or exempt callers with no own failures). Require a valid render token before unlock. Route through a template-managed limiter or document the exception per security.md. | Integration: 100 wrong unlocks from 10 keyed IPs, then the correct password from a new IP => 200 with token; wrong password from an 11th IP inside the minute => 422/429. | S | W2 |
| F-007 | Medium | api | A retried submit stores duplicate responses (no idempotency key): duplicate rows, emails, webhooks and cap slots | src/lib/intelform/api-public.ts:90-105 (no submission id); src/server/intelform/respondent/submit.ts:180-291; rule AGENTS.md Production rules ("guard anything a person may repeat with a unique key") | **Confirmed.** api respondent.mjs section 2 (respondent.out): identical body (same render token, browserToken, answers) POSTed 3x in parallel => 200,200,200; GET responses lists 3 rows; each insert queues its own notify job. <br>_Verification:_ Not independently verified (Medium) | On a weak mobile link the server commits but the reply is lost; the form re-enables Submit; the respondent presses again => second row, second owner email, second confirmation, second webhook; with a cap, a slot is wasted. | Duplicate data in table, summary and exports; duplicate downstream CRM records; relay quota spent. | Respondent generates a submissionId (uuid) once per fill; add column + partial UNIQUE (form_id, submission_id) (additive migration); INSERT ... ON CONFLICT DO NOTHING in the CTE; on conflict answer {ok:true} without re-queueing jobs. | Integration: two identical submits with the same submissionId (sequential and parallel) => 200 both, one row, one notify job. | M | W2 |
| F-008 | Medium | data-concurrency | Concurrent publishes create duplicate versions and then reject respondents who are part-way through the form (409 version_unknown) | src/server/intelform/builder/publish.ts:33-52 (LEFT JOIN form_versions ... FOR UPDATE OF f; early return re-evaluated under READ COMMITTED); src/portal/.../PublishButton.tsx:63-78 (no Idempotency-Key); effect src/server/intelform/respondent/submit.ts:102-118 | **Confirmed.** race-publish.mjs (race-publish.log): one unpublished change, 20 concurrent POST /forms/:id/publish => 20 x 200, versions 1 -> 21. race-publish-impact.mjs: 1 publish => a v1 respondent submits 200; 2 concurrent publishes => same respondent 409 version_unknown; 5 publishes with one Idempotency-Key => one v2, respondent 200. <br>_Verification:_ Not independently verified (Medium) | Two teammates (or two tabs, or a network retry) press Publish on the same edit within a few hundred ms; v2 and v3 are identical; everyone who opened v1 and submits inside the promised 24 h grace gets "This form has changed. Reload the page". | Mid-form respondents lose submissions; version history fills with duplicates that are never deleted. | Lock the form row first (SELECT ... FROM forms WHERE id=$1 FOR UPDATE), then read form_versions in a second statement, or decide on has_unpublished alone; have PublishButton send an Idempotency-Key per click. | Integration: has_unpublished=true, 10 concurrent publishes => exactly one new version and all replies name it; a submit with the previous version => 200. | S | W2 |
| F-009 | Medium | data-concurrency, ops | Migration 20261116150000_review_fixes is not wrapped in a transaction: a mid-file failure leaves the live DB half-migrated and blocks every later deploy | prisma/migrations/20261116150000_review_fixes/migration.sql:1-226 (no BEGIN;/COMMIT;); rule docs/agent/database.md:257; rollback model docs/agent/publishing.md:10-12 | **Confirmed.** data-concurrency migration-partial-apply.log and ops migration-partial.log: forced failure near the end => P3018; forms.starts_total, contacts, form_response_hours, triggers and functions remain; next deploy fails (P3009 / "column starts_total already exists") until manual repair. Every other app migration is wrapped. <br>_Verification:_ Not independently verified (Medium); reproduced by 2 areas on throwaway DBs | On a site with a large responses table, the contacts/hours backfill or CREATE TRIGGER ON responses hits a lock/statement timeout; the publish fails "keeping the previous version", but the new triggers already fire on that version's inserts, and every later publish fails. | Blocked deploys and a live DB that needs manual repair a site owner cannot easily do. | Wrap the file in BEGIN; ... COMMIT; (no CONCURRENTLY statements inside). If this migration has already been applied anywhere, do not edit it (checksum) - instead make it idempotent in a new migration; confirm with the template owner before changing an applied file. | Store/unit check: every app migration.sql (except single CREATE INDEX CONCURRENTLY files) starts with BEGIN; and ends with COMMIT;. Test that applies review_fixes with a forced failure and asserts no new objects remain. | S | W1 |
| F-010 | Medium | data-concurrency, privacy-legal | Contact erase, response delete and retention leave the erased answers in ready exports that stay downloadable for up to 24 h | src/server/intelform/contacts/query.ts:229-266 (deleteContacts); src/server/intelform/responses/table.ts:227-250; src/server/background.ts:122-166 (applyRetention); intelform_export_parts swept 24 h after created_at (exports/job.ts sweepExports); promise src/portal/screens/contacts.tsx:148 | **Confirmed.** data-concurrency erase-coverage.mjs (erase-coverage.log): contacts export ready, then erase => {contacts:1,responses:2}, responses/contacts/deliveries 0 rows, but an export_parts row still holds the email and GET /exports/:id/download => 200 with the erased email. privacy-legal README P4: same for kind responses and the all-responses ZIP; retention-probe.test.ts on real Postgres deleted 46 -> 41 responses and both export parts stayed. <br>_Verification:_ Not independently verified (Medium); reproduced by 2 areas | Staff export all responses; a respondent then asks to be erased; the admin erases and is told it is permanent; the earlier export with their name, email and answers is still downloadable for ~24 h. Same after retention. | Erasure and retention promises broken for up to 24 h; limited to the exporting user. | In deleteContacts, deleteResponses, applyRetention and form delete, delete (or mark stale and refuse download of) every intelform_exports row created before the delete that may contain the affected rows (simplest: all ready/running exports of kind all/contacts and responses of affected forms). Say in the erase dialog that existing exports are removed and that webhook/email copies are outside the app. | Integration: ready contacts export, erase a contact in it => GET /exports/:id/download returns 404/410 or no longer contains the email; same after applyRetention. | S | W2 |
| F-011 | Medium | api, security, privacy-legal | No audit event, re-verification or typed confirmation for IntelForm's destructive and bulk-export actions | src/server/routes/forms.ts:338 (DELETE form), responses.ts:189-190,227, contacts.ts:79 (erase), exports.ts:63 (kind all), builder.ts:201 (secret rotation), app-settings.ts:42; rules docs/agent/security.md:171-173,198-199,290; docs/agent/database.md:248-250 | **Confirmed.** api (matrix/lifecycle/delete/misc.mjs), security no-audit.mjs (no-audit.out.txt), privacy-legal: after deleting forms and responses, erasing a contact (no confirmation), exporting all, rotating a webhook secret and changing settings, audit_events held only signed_in_with_password, user_registered and user_roles_changed. grep "audit(\\|requireVerified" src/server finds no IntelForm file. <br>_Verification:_ Not independently verified (Medium); reproduced by 3 areas | An editor (or stolen editor session) erases contacts and bulk-deletes responses, or an admin downloads a ZIP of every response; the owner opens /dashboard/activity and sees nothing. | No accountability or forensic trail for permanent deletion and bulk PII export; breach of the project's own security rules. | Call the template audit helper with form_deleted, responses_deleted(count), contacts_erased(count), export_started(kind, formId), webhook_secret_rotated, app_settings_changed(keys) - ids and counts only, no PII. Add requireVerified and a typed confirmation to POST /contacts/delete and exports of kind all. | Integration: each of the 6 routes writes exactly one audit_events row with the expected action, the actor id and no email in meta; /contacts/delete and kind:all without confirm => 422. | M | W2 |
| F-012 | Medium | ops, requirements | A webhook retry whose job send is refused is marked done and never retried; builder copy says "One attempt per response" while deliveries retry up to 4 times | src/server/intelform/notify/notify.ts:410-422 (send refused -> markDone + 'failed'); src/portal/intelform/builder/settings/WebhookSection.tsx:109; background.json:7-8 (retries 4); README.md:26,66; legacy/docs/PLAN.md:30 ("no automatic retries") | **Confirmed.** ops job-loss.proof.test.ts third case: first attempt 503, retry send throws JobRejected(E_JOBS_RATE_LIMITED) => webhook:'failed'; re-running the job skips the webhook (done marker). Live on audit_ops against a 500 receiver: 2 attempts with one webhook-id (webhook-target-requests.log), log says "it would try 4 more times", contradicting the UI copy (requirements finding, code read). <br>_Verification:_ Not independently verified (Medium) | A receiver blips 5xx during the same busy minute the site is at its 10 jobs/min limit; the delivery stays failed forever unless someone presses Resend. A non-idempotent receiver told "one attempt" double-processes retries. | Webhook deliveries lost under load; creators told two different retry policies. | When the retry send is refused, throw instead of marking done (other steps are guarded by their markers). Change the copy to "Retried a few times on network errors and 5xx; dedupe on webhook-id; resend from the log". | Unit: webhook fetch 503 + send throwing JobRejected => runResponseNotify throws and the next run attempts the webhook again. Copy test on WebhookSection. | S | W1 |
| F-013 | Medium | requirements | One-per-email race returns 500 "Something went wrong" instead of 422 "already responded"; the existing race test asserts nothing | src/server/intelform/respondent/submit.ts:146-153 (isEmailKeyViolation requires P2002/23505 code; Prisma raw query raises P2010 with SQLSTATE only in the message), catch at ~:276; tests/integration/respondent.test.ts:102-110 (filters 422s then .every() on an empty array) | **Confirmed.** flows2/flows3.mjs (flows3.log), 3 rounds of 3 parallel submits with one email: each round one 200 and the others 500 {"error":"internal_error"}; server log: Raw query failed. Code: 23505 ... responses_email_key. <br>_Verification:_ Not independently verified (Medium) | A respondent double-submits (two tabs, retry) to a one-per-email form; the second request shows "Something went wrong." instead of "You have already responded". | No duplicate stored (unique index holds) but a misleading error and 500s in the logs; documented 422 behaviour broken under race. | In isEmailKeyViolation also accept P2010 (and driver-adapter errors) whose message/meta contains 23505 and responses_email_key; check against the platform db-socket error shape. | Change the integration race test to expect sorted statuses exactly [200, 422, 422]. | S | W2 |
| F-014 | Medium | privacy-legal | Built-in consent fields make respondents agree to a privacy policy that is empty and unlinked; no privacy notice where data is collected | src/lib/intelform/form/templates/index.ts:31-38 (consent() helper, link null; used :66, :250); src/lib/intelform/form/types/advanced.ts:99-103; intelform_settings.privacy_text default ''; src/pages/f/[slug].astro (no privacy link); settings/site.tsx:112-113 | **Confirmed.** privacy-legal README P1: form from builtin-lead-capture published; GET /site-api/public/forms/<slug> has required consent {"text":"I agree to the privacy policy ...","link":null}; GET /public-site/legal/privacy => text ""; /f/ HTML has no link to /privacy/. <br>_Verification:_ Not independently verified (Medium) | An owner makes a lead form from the built-in template; each respondent must tick "I agree to the privacy policy" to submit, but no policy exists or is linked, and nothing tells them answers go to a mail provider or webhook receivers. | Consent is not informed and there is no notice at collection (GDPR Art. 13) out of the box on every new install using these templates. Workaround: write a policy and link it per field. | Default the template consent link to /privacy/ (or render a "How your answers are used" link on /f/* when privacy text exists); warn in the builder (or block publish) for a consent field while privacy text is empty; ship a starting privacy text listing stored data and processors. | Unit: every built-in template consent field has a link (or the renderer adds one). Integration: publishing a consent form with empty privacy text returns a warning. | M | W2 |
| F-015 | Medium | privacy-legal | A keyed IP hash is stored on every response, never read, and joins to staff accounts' login hashes, contradicting the Survey template's "Your answers are anonymous" | src/server/intelform/respondent/submit.ts:264-266; src/server/intelform/respondent/crypto.ts:87-89 (subjectHash(secret,'ip',ip), same as audit_events/refresh_tokens/login_attempts.ip_hash); src/lib/intelform/form/templates/index.ts:135; src/content/site.ts:149; rules database.md:251, security.md:289 | **Confirmed.** privacy-legal README P2: survey from builtin-survey ("Your answers are anonymous") submitted with cf-connecting-ip 203.0.113.7, admin signed in from the same IP; SQL join responses.ip_hash = refresh_tokens.ip_hash returns user_id 1 (one match each in refresh_tokens, audit_events, login_attempts). grep: ip_hash written at submit.ts:264, read nowhere. <br>_Verification:_ Not independently verified (Medium) | A staff member answers the built-in "anonymous" survey from their usual network; anyone with DB access joins responses.ip_hash to refresh_tokens and names them; the same hash links one person across all forms. | A respondent-facing privacy promise is false; purposeless pseudonymous data kept against the project rule "store the minimum". | Stop writing responses.ip_hash (rate limits have their own keys); if ever needed use a per-form rotating salt. Store browser_token only when onePerBrowser is on. Remove "Your answers are anonymous" or add a real anonymous mode that skips country/device/browser. | Integration: after a submit, responses.ip_hash IS NULL and no responses column equals refresh_tokens.ip_hash for the same client IP. | S | W2 |
| F-016 | Medium | privacy-legal | No way to export one person's data (access request); the contacts CSV holds no answers | src/server/routes/exports.ts:63-124; src/server/intelform/contacts/query.ts:270 (CSV_HEADERS); rule docs/agent/database.md:248-250, security.md:290 | **Confirmed.** privacy-legal: POST /site-api/exports {kind:'contacts', query:{key:<contact with 4 responses>}} => CSV with only Name,Email,Phone,Country,Responses,Forms,First seen,Last active; contact detail API lists responses without answers. <br>_Verification:_ Not independently verified (Medium) | A respondent sends an access request; staff must open every form and every response one by one, because the per-contact export has no answers. | Access requests are not practically supported; breaches the project's per-person export rule. (Audit part merged into F-011.) | Add a per-contact export job (CONTACT_READ + RESPONSE_READ) that builds a bounded JSON/ZIP of every response for that contact_key with answers, audited. | Integration: per-contact export contains every answer of that contact across forms and writes one audit event. | M | W3 |
| F-017 | Medium | performance | Respondent page /f/<slug>/ misses the spec LCP (2.9 s vs 1.5 s on mobile Slow 4G) and its static JS (~125 KB gz) is over the 110 KB budget; no budget gate exists | src/pages/f/[slug].astro:104 (PublicForm client:only="react", SSR body has no visible content); budget legacy/docs/research/03-respondent.md + legacy/e2e/helpers/bundle-size.ts (not ported) | **Confirmed.** Production build via astro preview behind gzip proxy; Lighthouse 12.8.2 mobile, 3 identical runs on /f/contact-us/: perf 94, FCP 1.7 s, LCP 2.9 s (render delay 2,462 ms = 84%). page-weight.mjs: 113.7 KB static JS + layout chunks ~125 KB gz. C:/Users/Appifylab/intelform-audit-evidence/performance/lighthouse/summary.txt, logs/page-weight-unauth.log. <br>_Verification:_ Not independently verified (Medium) | A respondent on a mid-range phone (or inside an embed) sees only the themed background for ~3 s before the first question appears; future bundle growth goes unnoticed. | Higher drop-off on the core public flow; spec performance promise broken with no regression gate. | Server-render the first screen (title, description/start screen, first question label) with the rf-* classes and let the island take over; preload or statically import the form's layout chunk; port bundle-size.ts to a post-build check with BUDGET_KB=110 in npm run check. | Post-build test: /f/<seed>/ HTML contains the title and first question outside <noscript>, and the static JS closure is <= 110 KB gz; manual Lighthouse LCP <= 1.5 s as release check. | M | W4 |
| F-018 | Medium | frontend-a11y | Keyboard users cannot add a question from the builder palette: Enter/Space on "Add <type>" starts a hidden drag instead of adding | src/portal/intelform/builder/build/Palette.tsx:70-79 (useDraggable on the same <button> whose onClick adds) | **Confirmed.** builder.mjs/builder2.mjs (C:/Users/Appifylab/intelform-audit-evidence/frontend-a11y/logs/builder-keyboard.txt): Enter on "Add Email" => count unchanged, live region "Picked up draggable item palette:email."; 21 palette buttons with Enter => 0 questions (shots/builder-after-keyboard-add.png); mouse click adds. <br>_Verification:_ Not independently verified (Medium) | A keyboard or screen-reader user presses Enter on "Add Email": nothing is added and they hear raw ids; the working path (Add question combobox or "/") must be discovered. | WCAG 2.1.1 failure on the most visible build path; workaround exists. | Move the drag to a separate handle (as FieldCard does) or disable the KeyboardSensor for palette items so Enter/Space fire onClick; human labels in drag announcements. | Component/E2E: focus "Add Email", press Enter => one more Email question. | S | W4 |
| F-019 | Medium | frontend-a11y | Change-email form on Your account: both inputs have no accessible name (label for= points at a different id) | src/portal/screens/account.tsx:181-186 (Field id f-newEmail/f-emailPassword vs inputs f-email/f-password from src/portal/ui/form.tsx:152) - template-shipped screen (0.10.18) | **Confirmed.** axe "label" (critical) on #f-email and #f-password on /dashboard/account for every role, theme and width (crawl-*.json); DOM check detail1.mjs: input id f-email has 0 labels. <br>_Verification:_ Not independently verified (Medium) | A screen-reader user tabbing into Change email hears "edit text" and "secure edit text" with no names; clicking a label does not focus its field. | WCAG 1.3.1/4.1.2 Level A failure on an account-security form. | Check after the required template upgrade (template-owned code); otherwise pass the same id to Field and input or report upstream. | axe check on /dashboard/account in E2E; unit test that Field htmlFor matches the input id. | S | W3 |
| F-020 | Medium | code-quality | The required template upgrade will turn the test suite red: the app changed 5 template-owned test files that upgrade.md overwrites, and nothing records the edits | tests/integration/support/harness.ts:158-163; tests/integration/admin.test.ts:89-114; tests/list-page.test.ts:16-23; tests/permissions.test.ts:22-100; docs/agent/upgrade.md step 3 | **Confirmed.** scripts/simulate-template-tests-upgrade.sh (template-tests-upgrade-sim.log): restoring the 0.10.22 copies as step 3 does => 5 files / 19 tests fail (forms-api/responses 422/404, permissions "expected undefined to be site:job:manage", list-page ENOENT, admin 404). <br>_Verification:_ Not independently verified (Medium) | An agent performs the mandatory upgrade (release blocker), copies the template tests, loses the IntelForm harness changes silently, and "fixes" 19 confusing failures by weakening tests. | Release gate red during the mandatory upgrade; risk of losing test isolation. | Move IntelForm-specific cleanup into an app-owned helper (e.g. tests/integration/support/intelform-reset.ts) so harness.ts stays template-identical; document the remaining template-test edits in DEVELOPERS.md. | Re-run the simulation after the fix: forms-api and responses pass with an untouched harness.ts. | S | W3 |
| F-021 | Medium | baseline | The documented release gate does not run the integration suite: npm run check passes with 20 of 84 files / 175 tests skipped, and there is no CI | package.json "check", vitest.config.ts, tests/integration/support/harness.ts:21; DEVELOPERS.md section 7; AGENTS.md:366-368 | **Confirmed.** baseline #10: npm run check without TEST_DATABASE_URL => 64 passed / 20 skipped files, 1453 passed / 175 skipped tests (every auth, permission, submit, delete, erase, export test) (C:/Users/Appifylab/intelform-audit-evidence/baseline/logs/19-npm-run-check.clean.log). <br>_Verification:_ Baseline check (ran); not independently verified | A developer runs the gate on a fresh clone, sees green, and submits code that breaks submit, delete or erase. | Core-flow regressions can ship through a green gate. | Make npm run check fail (or loudly warn) when TEST_DATABASE_URL is unset, or start a throwaway Postgres for it; document in DEVELOPERS.md. | Running npm run check without TEST_DATABASE_URL exits non-zero or prints the skipped count prominently. | S | W3 |
| F-022 | Medium | baseline | No typecheck in any gate; astro check is red (4 TS2345 errors incl. src/pages/f/[slug].astro:62) and plain tsc is red on a fresh clone until astro sync | src/platform/files.ts:127 (template-owned CspApi type), src/pages/f/[slug].astro:62, checkout/index.astro:52,71, dashboard/[...path].astro:28 | **Confirmed.** baseline #2a-2d: tsc 38 errors before astro sync, 0 after; npx astro check without @astrojs/check exits 0 checking nothing; with @astrojs/check@0.9.12 => 4 errors (logs/03-tsc.log, 03c, 03e-astro-check.clean.log). <br>_Verification:_ Baseline check (ran); not independently verified | A type error in app code ships because no gate typechecks; astro check users see a red result they cannot fix in template-owned code. | Rubric-adjacent: typecheck red (rated Medium because the errors are type-only and in template-owned code, and the documented gate has no typecheck). | Add "astro sync && tsc --noEmit" (and @astrojs/check) to npm run check; re-check the CspApi errors after the template upgrade and report upstream if still present. | npm run check fails on an introduced type error. | S | W3 |
| F-023 | Medium | baseline | The core respondent experience and embedding have no automated test (respondent client 19% lines, layouts/PublicForm/upload at 0%, no E2E; legacy's 7 Playwright specs not ported) | src/respondent/*, src/server/routes/uploads.ts (31% lines), tests/ | **Confirmed.** baseline coverage run 4b and critical-paths table (logs/06c-coverage-areas.md); file-cleanup job has no handler in integration runs (logs/05-vitest-stderr.log). F-001 is exactly the class of defect this gap let through. <br>_Verification:_ Baseline check (ran); not independently verified | A change breaks rendering, a layout or the embed; every gate stays green (as happened with F-001). | Core public flow unprotected against regressions. | Port the legacy Playwright specs (direct fill in 3 layouts, embed cross-site, popup, signature upload) to run against a production build; add an integration test for the upload routes. | The E2E suite itself, run in the release gate. | L | W3 |
| F-024 | Medium | baseline | Two moderate advisories in production dependencies (hono 4.13.13 incl. GHSA-h7mg wildcard-middleware skip; astro 7.3.8 GHSA-mh32), fixable in range | package.json, package-lock.json | **Confirmed.** npm audit: 2 moderate (logs/09-audit.log); security area notChecked/covered notes. <br>_Verification:_ Baseline check (ran). Security area tested GHSA-h7mg against csrf/sameOrigin/bodyLimit: no bypass (Astro 404); GHSA-mh32 not applicable (no dynamic tag names) | A future route shape or Astro change makes the advisory exploitable against the wildcard guards. | No exploit found today; known-vulnerable versions ship. | npm audit fix (hono >= 4.13.16, astro >= 7.4.7) within declared ranges, then rerun the gate. | npm audit --omit=dev clean in the gate. | S | W3 |
| F-025 | Medium | ops | An export whose job runs out of retries stays "running" for 24 h with no failed state | src/server/intelform/exports/job.ts:73,118-124,161-167; src/server/routes/exports.ts:115-121; background.json intelform-exports retries 3 | **Likely.** Code trace: non-ExportError throws and refused next-part sends rely on platform retries; after the last try nothing sets status=failed; status route has no staleness check; only the 24 h sweep removes it. Map lead E1 also notes a possible same-key re-send dedupe (Suspected). <br>_Verification:_ Not independently verified (Medium, code trace only: jobs run inline locally) | An "export all" on a large site keeps hitting the run limit; the dashboard shows "running" for up to 24 h. | Hung export with no signal; workaround: start a new export. | Mark an export failed when running with updated_at older than ~15 min (status route or hourly job); show "didn't finish, try again". | Integration: insert a running export with updated_at 20 min ago => GET /exports/:id returns failed. | S | W2 |
| F-026 | Low (V↓ from Medium) | code-quality | Two parallel webhook delivery stacks have drifted ("Send test"/"Resend" vs real deliveries); a header value with a newline is saved (200) and then silently dropped by both | src/server/intelform/builder/webhook-core.ts:96-116 vs src/server/intelform/webhooks/config.ts:17-36; src/lib/intelform/form/settings.ts:45-53; dead queueWebhookDelivery/resendDelivery/assertWebhookUrl; stale comment webhook-delivery.ts:21-27 | **Confirmed.** C:/Users/Appifylab/intelform-audit-evidence/code-quality/differential.test.ts (differential.log): the two readWebhookConfig copies differ in 4/5 cases. v7: C:/Users/Appifylab/intelform-audit-evidence/verify/v7/webhook-header-drift.ts (.out.txt), run with npx tsx. <br>_Verification:_ V↓ from Medium: Confirmed Low (v7). Headline scenario (trailing newline sent by Test but not by real delivery) REFUTED - both drop it. Reproduced: NUL kept by Test path (fetch throws) but dropped by real path; legacy map-form headers sent only by real path; save schema accepts CR/LF/NUL | A creator pastes an Authorization value ending in a newline; save says OK; both test and real deliveries go out without the header and the receiver answers 401 with no hint why. | Maintainability drift (a fix in one stack misses the other) plus a silently-dropped header. | Keep one readWebhookConfig/secret/signed-POST implementation; delete dead functions and fix the comment; add .refine(v => !/[\r\n\0]/.test(v)) to webhookHeader.value (422 "Use one line"). | Unit: same settings through Test and real path produce identical headers; PUT webhook with a newline in a header value => 422. | M | W4 |
| F-027 | Low | api, code-quality | Malformed or empty JSON bodies return 500 internal_error on ~19 signed-in routes; a text/plain body is treated as {} and still creates a form | src/server/app.ts:115-124 (onError turns hono HTTPException 400 into 500); routes using validator('json')/zodJson (E16, E48, E56, E57, E62, E63, E65, E68, E78, E82, E85, E87, E98, E99, E102, E104, E107) | **Confirmed.** api matrix.out lines 471-519 + server-500-causes.log ("Malformed JSON in request body"); text/plain POST /forms => 201 blank form. code-quality bad-input-sweep.log, malformed-json.log. <br>_Verification:_ Not independently verified (Low) | A truncated autosave sends broken JSON; the API answers 500 and logs an error-level server fault. | Noisy monitoring, misreported client errors; an unintended side effect for wrong content types. | In app.onError return err.getResponse() (or a 400 invalid_json problem) for HTTPException; refuse non-JSON content types on JSON writes with 415. | POST /site-api/forms with "{" => 400; empty => 400; text/plain => 415 and no form inserted. | S | W1 |
| F-028 | Low | api | A NUL character or lone surrogate gives 500: an anonymous submit fails every time and dashboard search breaks | POST /site-api/public/forms/:slug/responses (submit.ts insert CTE, JSONB); GET /site-api/forms?q=, /responses/forms/:id/responses?q=, /contacts?q= | **Confirmed.** api nul.mjs (nul.out): "Hello\u0000world" => 500 (22P05); "\ud800" => 500 (22P02); q=%00 => 500 on three lists (22021). <br>_Verification:_ Not independently verified (Low) | A respondent pastes text with a NUL or broken emoji; Submit fails with the generic error forever. | Rare, but a lost submission with no hint. | Strip/reject \u0000 and unpaired surrogates (toWellFormed) in the shared text answer schema and in every q schema; 422 field error for answers. | Submit with \u0000 and \ud800 => 200 (sanitised) or 422, never 500; GET /forms?q=%00 => 200. | S | W2 |
| F-029 | Low | requirements, privacy-legal | Retention: README says per-form retention but it is one app-wide setting; the retention job does not clear the summary and contacts caches | README.md:68-69 vs src/lib/intelform/settings-app.ts:105-108; src/server/background.ts:49-53,122-166 (no clearSummaryCache/clearContactsOverview) | **Confirmed.** requirements: real applyRetention on Postgres deleted 41 of 63 responses, counts consistent, no cache clear (manual delete routes do clear: routes/responses.ts:103, contacts.ts:92). privacy-legal retention-probe.test.ts same. <br>_Verification:_ Not independently verified (Low) | An owner expecting per-form retention turns on 30 days and loses all forms' older responses; after the 04:30 run the summary shows deleted responses for up to 5 min and contacts for 10. | Docs mismatch that can lead to unintended permanent deletion; short-lived stale display of deleted personal data. | Fix README.md:68 ("app-wide retention period, Settings > Data"); call clearSummaryCache() and clearContactsOverview() after applyRetention deletes rows. | Job test: after applyRetention deletes rows, the cache keys are gone. | S | W2 |
| F-030 | Low | requirements | Notification recipient list renders m.email, which /builder/teammates never returns (teammates with the same name are indistinguishable) | src/portal/intelform/builder/settings/sections.tsx:413 vs src/server/routes/builder.ts:318-343 | **Confirmed.** flows4.log: /builder/teammates => {"members":[{"id":2,"name":"Req admin","owner":false},...]} with no email. <br>_Verification:_ Not independently verified (Low) | Two teammates named "Alex" cannot be told apart under "Who gets it". | Minor UI defect (the API correctly hides emails). | Drop description={m.email} or show a role/masked address from the server. | Portal test rendering the list from the real API shape. | S | W1 |
| F-031 | Low | api | A viewer can write form_presence rows without limit (no rate limit on the presence heartbeat) | POST /site-api/builder/forms/:id/presence, src/server/routes/builder.ts:135-150 | **Confirmed.** api misc.mjs presence (misc.out): viewer, 60 POSTs with new tabIds => 60 x 200, rows swept only after 1 h. <br>_Verification:_ Not independently verified (Low) | A compromised viewer account loops presence with random tabIds; tens of thousands of rows an hour; every editor's presence poll grows. | Billed writes and bloat; needs a signed-in account. | Per-user rate limit (e.g. 10/min per user and form) or cap distinct tab ids per user via intelform_rate_limits. | 30 presence posts by one user in a minute => 429 after the limit. | S | W4 |
| F-032 | Low | security, ops (hit by every area) | Local dev server silently ignores DATABASE_URL from the shell and uses .env, while Prisma CLI and dev-admin honour the shell | src/platform/config.ts:1,43-44 (env from cloudflare:workers, filled from .env); prisma.config.ts:7; README.md / DEVELOPERS.md local setup | **Confirmed.** security: sign-ups through "DATABASE_URL=...audit_security npx astro dev" landed in site (3 rows) while migrate/seed/dev-admin used audit_security. ops, api, data, privacy, a11y, code-quality, v4, v6, v8 report the same. <br>_Verification:_ Not independently verified (Low); reproduced by 8 auditors/verifiers, several of whom wrote test rows into the shared "site" DB as a result | A developer points DATABASE_URL at a throwaway DB to test retention or erase; migrations go there, the running app deletes from the .env database. | Development-time writes/deletes against the wrong database (production unaffected). | Document it; have the dev server log the database name (not URL) at startup and warn when process.env.DATABASE_URL differs from .env; dev-admin/seed print their target. App-level tooling only. | Smoke script: start dev with a different shell DATABASE_URL and assert the warning. | S | W1 |
| F-033 | Low | data-concurrency | Contacts rollup loses updates when a submit and a delete for the same person run at the same time on different forms | prisma/migrations/20261116150000_review_fixes/migration.sql:66-89 (intelform_contacts_refresh snapshot recompute) with :119-137 (incremental insert trigger) | **Confirmed.** race-contacts-trigger.mjs (race-contacts-trigger.log): deterministic two-session interleaving => contacts n=3, form_count=3 while responses has 4 rows over 4 forms. race-contacts-api2.log did not reproduce; retention-real-pg.log shows the same pattern on last_response_at (27 ms). <br>_Verification:_ Not independently verified (Low); reproduced at DB level, not through the API (8 rounds) | X submits form C while an admin deletes X's older response on form A; the Contacts screen shows the wrong count and filtering by C does not list X until the next recompute. | Wrong derived counts/filters; erase still works by contact_key. | pg_advisory_xact_lock(hashtext(key)) per key (sorted) in both triggers, or lock contacts rows before recomputing, or make the delete trigger decrement. | Two-connection integration test asserting contacts.n and form_ids equal the truth after both commit. | M | W4 |
| F-034 | Low | data-concurrency | "One response per browser" does not hold under concurrent submits (25 of 40 identical-token submits stored) | src/server/intelform/respondent/submit.ts:168-173, :220-225 (pre-check SELECT only; no unique index on (form_id, browser_token)) | **Confirmed.** race-per-person.mjs (race-per-person.log): 40 concurrent submits, same browserToken, different IPs => 25 x 200, 15 x 409. <br>_Verification:_ Not independently verified (Low) | A double-click or scripted retry stores several responses on a one-per-browser form, each firing notifications and webhooks. | Duplicates on a setting labelled a "soft limit". | Partial UNIQUE index on responses(form_id, browser_token) WHERE browser_token IS NOT NULL (additive), map 23505 to 409. | 10 parallel submits, same browserToken => 1 row, 9 x 409. | S | W2 |
| F-035 | Low | ops | /site-api/health reports ok and database:true while the database is down | src/server/app.ts:80-88 | **Confirmed.** Live on audit_ops with ALLOW_CONNECTIONS false: GET /health => 200 {"ok":true,"database":true}; same moment /f/<slug>/ 503 and public API 500. <br>_Verification:_ Not independently verified (Low) | An uptime probe says healthy during a full DB outage. | Outage undetectable from the only health endpoint. | Cached, rate-limited SELECT 1 with short timeout; database:'up'\|'down' and 503 when down. | DATABASE_URL to a closed port => /health 503 database:'down'. | S | W4 |
| F-036 | Low | ops | Respondent API answers 500 internal_error, not 503 with Retry-After, when the database is unreachable | src/server/app.ts:120-124 (onError -> 500), affects E91, E94, E111 | **Confirmed.** Live outage test: submit after load => 500 {"error":"internal_error"} without Retry-After; SSR /f/ correctly 503. <br>_Verification:_ Not independently verified (Low) | During a DB blip respondents get a generic error that does not say "try again in a moment". | Poor recovery guidance; monitoring cannot tell outage from bug. | Map P1001/P1017, SQLSTATE 55000/57P01 to 503 + Retry-After in onError; respondent UI "try again in a moment". | Unreachable DB => POST responses 503 + Retry-After. | S | W1 |
| F-037 | Low | performance | Webhook delivery log polls every 3 s forever while any delivery stays "pending"; nothing expires a stuck pending row | src/portal/intelform/builder/settings/queries.ts:55; src/server/intelform/builder/webhook-core.ts:185; no sweep in src/server/background.ts | **Confirmed.** Inserted (audit DB) a 3-day-old delivery with no outcome => GET deliveries "pending":true; each poll = 4 statements (logs/query-count-polling.log). <br>_Verification:_ Not independently verified (Low) | A lost test-delivery job leaves "sending" forever and every open Webhook tab polls every 3 s. | ~80 billed queries/min per open tab; misreported lost delivery. | Treat rows with no outcome older than ~10 min as failed ("Delivery didn't run. Use Resend."), or mark them in hourly maintenance; cap the client poll. | Delivery row 1 h old with no outcome => pending:false, ok:false. | S | W4 |
| F-038 | Low | performance | Home page downloads 3 font families (83 KB, more than its JS+CSS) and /fonts/* are served max-age=0 | src/styles/fonts.css; src/styles/home.css:33,200,514; public/_headers | **Confirmed.** Lighthouse network on /: fonts 83.4 KB vs script 17.3 KB, CSS 10.9 KB; logs/cache-headers.log: /fonts/... cache-control public, max-age=0, must-revalidate. <br>_Verification:_ Not independently verified (Low); production header Likely the same (no _headers rule) | First visit fetches 41 KB of JetBrains Mono for small labels; every later visit revalidates each font. | Extra bytes and round trips; breaks performance.md font guidance. | System mono stack for those labels; add /fonts/* Cache-Control: public, max-age=31536000, immutable to public/_headers. | Build check for the _headers rule; page-weight asserts <= 2 font files on /. | S | W4 |
| F-039 | Low | performance | Build screen lazy chunk over the per-screen budget (54.6 KB gz, 69.9 KB with new imports; budget < 50 KB) | src/portal/intelform/builder (build.*.js); budget docs/agent/performance.md "Pages" | **Confirmed.** scripts/screens.mjs on the production build (logs/portal-screens.log); other screens under budget. <br>_Verification:_ Not independently verified (Low) | An editor on a slow link waits on 70 KB before the builder is usable. | Slower builder open for staff. | Lazy-load the field-settings panel and dnd-kit drag layer. | Post-build check failing when any screen chunk > 50 KB gz. | M | W4 |
| F-040 | Low | frontend-a11y | Contacts: the "Show or hide columns" icon button has no accessible name | src/portal/screens/contacts.tsx:344; src/portal/ui/popover.tsx:138 | **Confirmed.** axe button-name (critical) on /dashboard/contacts for all roles/themes/widths. <br>_Verification:_ Not independently verified (Low) | A screen-reader user hears "button, collapsed, has popup dialog" with no name. | Breaks AGENTS.md "icon-only buttons have aria-label"; WCAG 4.1.2. | Keep aria-label={label} when the trigger is icon-only, or a visually-hidden span. | axe button-name on /dashboard/contacts. | S | W4 |
| F-041 | Low | frontend-a11y | Contacts table "+N more" chip is unreadable (contrast 1.39:1) in light and dark | src/styles/intelform/contacts.css:201-207 | **Confirmed.** axe color-contrast (serious), 12 nodes; computed rgb(90,88,81) on rgb(113,110,103). <br>_Verification:_ Not independently verified (Low) | A creator cannot read how many more forms a contact answered. | WCAG 1.4.3; minor. | Foreground token reaching 4.5:1 on --subtle. | axe color-contrast on contacts, light and dark. | S | W4 |
| F-042 | Low | frontend-a11y | App settings forms do not link errors to fields or focus the first wrong field | src/portal/intelform/settings/general.tsx:62-69 and the 6 other screens using useFormErrors | **Confirmed.** settingsform.mjs (logs/settings-form.txt): empty App name + Save => error shown, focus stays on Save, input lacks aria-describedby; grep: 0 aria-describedby in settings/*.tsx. <br>_Verification:_ Not independently verified (Low) | A keyboard user saves with an empty name and has to hunt for the error. | Breaks AGENTS.md "Fields" rules. | Use the kit useForm or add focus-first-invalid and aria-describedby to useFormErrors. | E2E: empty name => activeElement #as-app-name with aria-describedby to its error. | S | W4 |
| F-043 | Low | frontend-a11y | Focus is lost to <body> after closing contact Filters, keyboard reorder, question Delete and Publish | src/portal/intelform/contacts/Filters.tsx:48-58; build/FieldCard.tsx; PublishButton.tsx | **Confirmed.** esc.mjs, builder3.mjs (logs/dialogs.txt, builder-dialogs.txt). <br>_Verification:_ Not independently verified (Low) | After these actions the next Tab starts from the top of the page. | WCAG 2.4.3 keyboard friction. | Return focus to opener / moved or next card / an enabled status control. | E2E keyboard tests asserting activeElement after each action. | S | W4 |
| F-044 | Low | frontend-a11y | Builder ARIA misuse: aria-expanded on role=textbox pipe editors; viewer view has <ol> with role=button children and unfocusable scroll regions | src/portal/intelform/builder/pipe; build/Canvas.tsx:70; .if-palette-body, .if-design-panel | **Confirmed.** axe aria-allowed-attr, list, scrollable-region-focusable (crawl-1440-admin_editor_viewer_nobody-light_dark.json). <br>_Verification:_ Not independently verified (Low) | Screen readers misreport the pipe editor; a keyboard-only viewer cannot scroll the palette/design panel. | Minor a11y defects. | role=combobox for pipe editors; <li> wrappers in read-only mode; tabIndex=0 + aria-label on scroll containers. | axe on build and design as viewer and editor. | S | W4 |
| F-045 | Low | frontend-a11y | Close-on-date picked inside a spring-forward DST gap is stored with the wrong offset (form may close an hour early) | src/portal/intelform/builder/tz.ts:31-43 (zonedToIso) | **Confirmed.** scripts/tztest.mts (logs/tz-closeat.txt): 2026-03-08T02:30 America/New_York => -04:00, reads back 01:30; London and Sydney gaps similar. <br>_Verification:_ Not independently verified (Low) | A creator sets "close at 02:30" on a spring-forward night; the form closes at 01:30. | Rare edge case. | Detect non-existent local times and reject with a field error or shift forward explicitly. | Unit tests for zonedToIso/isoToZoned at NY, London, Sydney gaps. | S | W4 |
| F-046 | Low | frontend-a11y | Insert-question search: typing "Multiple" and Enter inserts Single choice | src/portal/intelform/builder/palette-search.ts:7-8 | **Confirmed.** builder4.mjs (logs/builder-dialogs.txt). <br>_Verification:_ Not independently verified (Low) | A keyboard user adds "Multiple choice" by name and silently gets a radio question. | Wrong question type until noticed. | Rank label prefix matches above keyword matches, or drop "multiple choice" from single_choice keywords. | search('Multiple')[0] === 'multiple_choice'. | S | W4 |
| F-047 | Low | code-quality | Dead and duplicate code left from the migration; tests cover dead copies (PNG validator, CSV escaper, SSRF helper), unused dependency @dnd-kit/helpers | src/server/intelform/respondent/png.ts (tests only; live copy uploads/png.ts); forms/core.ts:241-260 webhookUrlProblem; src/form-types/summaries.tsx + 20 SummaryCard.tsx; portal/intelform/builder/ImageUpload.tsx, portal/intelform/upload.ts; lib/intelform/roles.ts; contacts/csv.ts vs responses/csv-text.ts; package.json @dnd-kit/helpers | **Confirmed.** unreferenced-files.txt, unused-exports.txt (15 unused), differential.log (webhookUrlProblem allows https://foo.corp/a which the live SSRF check refuses). <br>_Verification:_ Not independently verified (Low) | A developer fixes a PNG/CSV bug in the tested copy; tests go green; production still uses the other copy. | ~700 dead lines, false test assurance. | Delete the dead copies, repoint tests at live modules, npm rm @dnd-kit/helpers. | Add an unreferenced-files (or knip) check to npm run check. | S | W4 |
| F-048 | Low | code-quality, baseline | The test suite under coverage intermittently crashes a worker and drops a whole test file (builder-api.test.ts) while the summary lists only passes | vitest.config.ts (pool forks, fileParallelism:false) | **Confirmed.** C:/Users/Appifylab/intelform-audit-evidence/code-quality/coverage-run1.log vs coverage-run2.log; C:/Users/Appifylab/intelform-audit-evidence/baseline/logs/04-vitest-coverage-run1.tail.log. <br>_Verification:_ Not independently verified (Low); reproduced in baseline and code-quality (1 of 2 runs each) | Coverage as a gate goes red half the time, or a reader trusts "81 passed" while a file never ran. | Flaky gate; exit code 1 does flag it. | poolOptions.forks.singleFork or --pool=threads, more worker memory, --reporter=verbose; investigate builder-api.test.ts memory. | Three consecutive coverage runs with identical file counts. | S | W3 |
| F-049 | Low | code-quality | Leftover from the template's removed job board: "Manage jobs" permission still offered and granted to admin | permissions row site:job:manage; GET /site-api/admin/permissions; tests/integration/support/harness.ts TRUNCATE list | **Confirmed.** Live: GET /admin/permissions includes site:job:manage "Manage jobs"; admin role_permissions include it; no /jobs route exists. <br>_Verification:_ Not independently verified (Low) | An admin grants "Manage jobs", which does nothing. | Confusing roles UI. | Add-only data migration removing the permission rows if the template allows; else note in README. | GET /admin/permissions has no site:job:* codename. | S | W4 |
| F-050 | Low | code-quality | /f/<slug>/ reads the database directly from the page instead of through the Hono Site API (architecture rule) | src/pages/f/[slug].astro:25,45; src/pages/f/_lib/page.ts:13-15,63-75; rule AGENTS.md "Architecture" | **Confirmed.** Code trace: page calls getDb(), runs its own rate-limit upsert and loader, separate state/error mapping from E91. <br>_Verification:_ Not independently verified (Low; code trace) | A guard or header added to GET /public/forms/:slug does not apply to the SSR page; the two drift. | Maintainability/review risk on the most important public page; no defect today. | Call the route in-process with backend(Astro.request), or document the exception with a parity test. | Parity test: loadFormPage and E91 return the same state for live, closed, draft, moved slugs. | M | W4 |
| F-051 | Low | privacy-legal | One-per-email tells anyone whether a given address has already responded (and lets them pre-register a victim's address) | src/server/intelform/respondent/submit.ts:149; on by default in 4 built-in templates (templates/index.ts:50,102,203,261) | **Confirmed.** privacy-legal README P6: alice.probe+2@example.com from another IP => 422 "You have already responded to this form." <br>_Verification:_ Not independently verified (Low) | Someone types a colleague's address into a sensitive application form and learns whether they applied. | Participation disclosure; rate-limited and opt-in. | Return the normal success screen on duplicate without inserting (optionally email the address owner), or warn in the builder. | Duplicate email submit returns the same status/body as a fresh one; no second row. | S | W4 |
| F-052 | Low | baseline | store-check's npm audit never runs on Windows (execFileSync('npm') ENOENT reported as "offline") | store-check.mjs:950 (template-owned) | **Confirmed.** node -e "require('child_process').execFileSync('npm',['-v'])" => ENOENT (logs/13-store-check.clean.log). <br>_Verification:_ Baseline check (ran) | A Windows developer believes the audit step passed/skipped for network reasons. | Missed advisories on Windows. | Report upstream (template-owned); run npm audit manually meanwhile. | n/a (template) | S | W3 |
| F-053 | Low | baseline | Install-script hygiene: allowScripts pins an older workerd (postinstall blocked) and app-added free-email-domains has a network-fetching postinstall | package.json allowScripts; dependency free-email-domains (commit 3832f7e); rule docs/agent/security.md:79-80 | **Confirmed.** logs/01-npm-ci.log, 01b-install-scripts.log. <br>_Verification:_ Baseline check (ran) | A future install allows the fetching postinstall, pulling remote data at install time. | Supply-chain rule breach (currently blocked). | Replace free-email-domains with a vendored list or a dependency without install scripts; align allowScripts with the lockfile workerd. | store-check install-script check stays PASS; lockfile hasInstallScript list reviewed. | S | W3 |
| F-054 | Low | baseline | No linter configured (legacy used oxlint); oxlint shows 41 warnings | package.json (no lint script) | **Confirmed.** npx oxlint@1.88.0 src tests: 41 warnings, 0 errors (logs/07-oxlint.clean.log). <br>_Verification:_ Baseline check (ran) | Unused vars, unsafe optional chaining and control-char regexes accumulate unnoticed. | Maintainability. | Add oxlint with the legacy config to npm run check. | Lint step in the gate. | S | W3 |
| F-055 | Low | ops | Postmark sends (and relay retries) have no idempotency key: a timeout followed by a job retry sends duplicate emails | src/server/intelform/notify/mailer.ts:116-143 (postmarkProvider ignores opts.idempotencyKey); notify.ts:116 | **Likely.** Code trace: Resend gets Idempotency-Key (mailer.ts:102); Postmark drops it; done marker written after send returns. <br>_Verification:_ Not independently verified (Low; code trace) | Postmark accepts but times out at 15 s; the job retries; the respondent gets two confirmations. | Duplicate emails; minor. | Record an "attempted" marker before sending to Postmark (at-most-once) or document the difference. | Postmark fake timing out once, then a rerun => exactly 1 provider call. | S | W4 |
| F-056 | Low | code-quality | Builder last-chance save checks the 64 KB keepalive cap in UTF-16 characters, not bytes; the flush fails silently for non-Latin drafts | src/portal/intelform/builder/api.ts:12,29,49-63; lifecycle.ts:82-101 | **Likely.** keepalive-bytes.log: Bengali draft JSON length 24,063 (passes <= 60000) = 72,063 UTF-8 bytes (> 64 KiB keepalive limit); rejection swallowed, returns true. <br>_Verification:_ Not independently verified (Low; code trace + calculation, no browser) | A creator writing Bengali closes the tab on mobile; the last edits since the previous autosave are lost. | Occasional loss of recent builder edits for non-Latin creators. | Measure TextEncoder byte length; fall back to the normal flush when over the cap. | keepalivePatch with a 25k-char Bengali body returns false and makes no keepalive fetch. | S | W4 |
| F-057 | Low | privacy-legal | 20 SIL OFL web fonts are redistributed with no licence text | public/fonts/*.woff2 (20 files, commit 3832f7e); no OFL.txt | **Likely.** ls public/fonts; git ls-files shows only the template LICENSE. <br>_Verification:_ Not independently verified (Low; embedded name tables not read) | Each deployed site redistributes the fonts without the notice OFL 1.1 condition 2 requires. | Licence-compliance gap; store review covers licences. | Add public/fonts/OFL.txt with each family's copyright line; mention in README. | Check that every public/fonts family has a licence entry. | S | W3 |
| F-058 | Low | baseline | Client bundle imports a module that imports node:crypto (externalized with a build warning) | src/lib/password-checks.ts, src/lib/rules.ts -> src/platform/auth/password.ts | **Likely.** logs/08-build.clean.log warning. <br>_Verification:_ Baseline check (build warning); runtime failure not traced | A portal screen path that reaches the crypto import fails in the browser. | Possible runtime error; not observed. | Split browser-safe password rules from the server hashing module. | Build with warnings-as-errors for node: imports in the client. | S | W4 |


---

## 5. Systemic issues

| Id | Root cause | Findings | One fix that addresses the group |
|---|---|---|---|
| S1 | Anonymous respondent routes are guarded like signed-in routes. Cookie-based CSRF is applied to callers that have no session and may sit in a third-party frame | F-001 | Give the respondent API its own middleware stack: sameOrigin plus render token, with no cookie double-submit |
| S2 | Work that follows a commit is fire-and-forget. Job sends, relay calls and retries are not recorded anywhere a later run can pick them up, and job outcomes are discarded, so the Jobs tab always says "succeeded" | F-002, F-003, F-004, F-012, F-025, F-037, F-055 | An outbox written in the same statement as the response, plus a catch-up in hourly maintenance. Throw on refusals instead of marking done. Surface outcomes in job results. Add staleness rules for "running" and "pending" rows |
| S3 | UI copy, README and template text promise behaviour the code doesn't have | F-003, F-012, F-014, F-015, F-026, F-029, F-030 | Tie copy to capability flags returned by the server (mailConfigured, retry policy). Add copy tests. Review README.md:24-26, 66-69 and 95-99 against the code |
| S4 | Repeatable writes have no unique key or idempotency | F-007, F-008, F-013, F-034 | submissionId plus partial unique indexes. Lock the form row first in publish. Send Idempotency-Key from the UI. Map 23505/P2010 to 409/422 |
| S5 | Deletes don't reach derived copies of personal data | F-010, F-016, F-029, F-033 (and map lead F2: signature left in storage after 5 failed cleanups, not verified) | A single "personal data was deleted" hook, called by erase, delete, retention and form delete. It invalidates exports and caches and records the deletion |
| S6 | Error mapping is all-or-nothing: `app.onError` turns every throw into 500 | F-013, F-027, F-028, F-035, F-036 | Map HTTPException to its own status, connection errors to 503 with Retry-After, and known SQLSTATEs to 4xx. Sanitise text input |
| S7 | Project-rule plumbing is missing from the app layer: audit events, the managed password check, and the rule that the Site API is the only backend | F-006, F-011, F-050 | Add audit() calls and requireVerified to the dangerous routes. Route the unlock through a managed limiter. Use backend() from the /f/ page |
| S8 | The release gate doesn't reflect reality | F-009, F-017, F-019, F-020, F-021, F-022, F-023, F-024, F-039, F-047, F-048, F-052, F-053, F-054, F-058 | One `npm run check` that runs the integration tests (with a throwaway DB), typecheck, lint, bundle budgets, the migration-wrapping check and an E2E smoke test including the embed |
| S9 | Size limits are measured in the wrong unit or at the wrong layer | F-005, F-056 | Measure in UTF-8 bytes, and set per-route body limits that match the documented answer limit |
| S10 | Local DB isolation trap: `astro dev` reads `.env` and ignores a shell DATABASE_URL | F-032 | Log the database name at startup and warn on a mismatch. **Several auditors wrote to the shared `site` database because of this. See section 8 for the rows to clean up** |

---

## 6. PRD coverage

The PRD itself is not on this machine. Coverage is measured against the legacy README, docs/PLAN.md, docs/research and e2e specs, and against the current README. This table comes from the requirements area; evidence files are in [C:/Users/Appifylab/intelform-audit-evidence/requirements/](audit/evidence/requirements/).

| Feature | Status | Evidence |
|---|---|---|
| 21 question types | Complete (server) | A form with all 21 types was saved, published and submitted (flows.log). frontend-a11y: axe-clean in every layout |
| Conditional logic (server re-validation) | Complete | A hidden f_cond answer is rejected and a shown required one is enforced (flows.log, try-submit2) |
| Answer piping | Not verified in the UI | Only the publish lint was read. The `{{id}}` token used in the test may not be the real piping token |
| 3 layouts | Complete | All three submit in headless Chrome when opened directly (layouts.log). section_by_section was not driven by keyboard |
| Autosave revision / If-Match | Complete (API) | flows.log. Keepalive flush issue: F-056 |
| Versions and 24 h grace | Complete; breaks under concurrent publish | E50, grace for v-1, 409 for v-2. F-008 |
| Templates (10 built-in, save as, from saved) and duplicate | Complete | flows5.log. Template privacy copy: F-014, F-015 |
| Close, reopen, response cap, close date | Complete | flows.log. data-concurrency race-cap.log (exact under 40-way contention) |
| Slug redirects | Complete | flows.log (301, old-slug API returns "moved") |
| Password gate | Complete; can be locked out by anyone | flows2.log. F-006 |
| One response per email | Partial: a race gives 500 | flows3.log. F-013, F-051 |
| One response per browser | Complete when sequential, not under concurrency | flows2.log. F-034 |
| Redirect with answers | Complete (signature excluded by design) | flows2.log |
| Embed: inline and popup | **BROKEN** | embed-submit.log. F-001 |
| Responses table, delete, summary | Complete | flows.log, flows5.log |
| CSV and ZIP export | Complete; no failed state when a job dies | flows.log, flows5.log. F-025 |
| Contacts list, export, erase | Complete; erase doesn't reach exports; no per-person export | flows2.log, flows5.log. F-010, F-016 |
| Owner notification | Partial: link only, dropped on relay 429 | flows4. F-003, F-004 |
| Teammate notifications and respondent confirmations | **BROKEN without a mail provider**, while the UI says no setup is needed | flows4. F-003 |
| Webhooks | Not run end to end (the SSRF guard blocks a local receiver). Copy mismatch | ops fake-receiver runs prove signing, timeout, cap and retry. F-012, F-026 |
| Retention | Complete (deletion correct); caches stale; README says per-form | vitest run on real PG. F-029 |
| Public hub listing; closed form removed | Complete | flows5 |
| Privacy link hidden while the text is empty | Complete | It works as coded, but see F-014 |
| Long answers | Partial (64 KB) | flows3. F-005 |
| Respondent performance budget (LCP ≤ 1.5 s, JS ≤ 110 KB) | Not met | F-017 |
| Accessibility of the respondent form | Complete | axe 0 violations across 6 forms × 4 widths × 2 themes |

---

## 7. Coverage of the map

The map is in [endpoints.md](audit/evidence/map/endpoints.md) (117 endpoints, E1-E118, with no E76) and [data-state-jobs.md](audit/evidence/map/data-state-jobs.md) (31 state transitions, T1-T31).

**Endpoints: 77 of 117 exercised live.**
- 74 fully, 3 partially (E102, E104, E105: there is no platform file storage locally).
- 2 more by code trace only (E1, E103).
- E22 and E23 cannot be exercised: they are the owner's "View as admin".
- 36 were not reviewed. 30 are template-owned auth and admin routes, which are out of IntelForm scope: E8, E9, E11-E15, E17-E21, E24-E34, E36-E40, E44, E45. The other 6 are template payment and membership routes that IntelForm doesn't use (E2, E114-E118).
- Every IntelForm-owned endpoint (E47-E113) was exercised except E103 and the happy paths of E102, E104 and E105.
- Highlights: a role matrix of 250 checks (api) plus 43 routes × 4 roles (security), with no authorization violation. Malformed-input sweeps covered 21 writes and 38 GETs. Every respondent endpoint was raced.

**State transitions: 26 of 31 exercised live, plus 1 by a hosted-mode proof test (T17).**
- 2 by code trace only: T22 export failed, and T28 signature abandoned after 5 failed cleanups.
- T24 is partial (refusals only).
- T25 and T27 were not run, because they need platform files.

The full per-row tables are in Appendix A.

**Skipped in all areas:**
- template auth internals beyond sign-up and sign-in
- template payments
- the owner role
- platform files: uploads, signature storage, file cleanup
- real platform job delivery, retries and dead-letter
- real email delivery

---

## 8. What was not checked, and why

| Item | Why | What it would take |
|---|---|---|
| Owner "View as admin" (E22/E23), owner-only paths, owner as notification recipient | Not possible locally (needs the platform) | A Preview or hosted site with an owner session |
| Platform files: image uploads E102/E103, signature happy path E104/E105, SVG serving, file cleanup T25/T27/T28, map lead F2 (signature left in storage) | No SITE_KEY or file store locally (503 storage_not_configured) | A Preview or hosted site with storage |
| Real platform jobs: retry exhaustion, dead-letter view, job-key dedupe, JobRejected live, Worker CPU and memory limits for exports | Locally, jobs run inline (`runsJobsLocally`) | A hosted site with a Site Key and access to its Jobs tab. F-002, F-004 and F-025 were proven with stubs |
| Real email: relay quotas, per-recipient cap for kind `notification`, SPF/DKIM, Resend/Postmark failure paths | No Site Key or provider keys, and no email may be sent to real people | A staging site with a real Site Key. F-004 part (b) is Unconfirmed for this reason |
| Webhooks end to end under the PRODUCTION SSRF policy; DNS-rebinding and public-name-to-private-IP | The local policy allows private hosts. The production egress block can't be tested | A unit run of assertSafeUrl with production options (the security area ran 30 bypass forms against the real function), plus a hosted receiver |
| Turnstile | No keys on this machine | Cloudflare test keys set as owner secrets |
| Real deployed latency and the Site Cache | Local workerd and pg have a ~200 ms floor. site-cache.internal is unreachable | A hosted Preview |
| Safari, Firefox, real mobile devices, touch (signature drawing, drag and drop); real screen readers (NVDA/VoiceOver) | Only headless Chrome was available | Manual passes |
| Section-by-section layout driven by keyboard; answer piping in the browser | Time; uncertainty about the piping token | A sectioned form plus the real token |
| Load and concurrency at scale: 100k+ responses per form, migration lock duration on a large table | The machine is shared | A bigger seed and ~10 minutes of exclusive time |
| Backup and restore / PITR | Not documented anywhere in the repo. With no erasure log, a restore would bring erased people back | Ask the platform team what is backed up and for how long |
| Template-owned auth routes E8-E46 (attacks), template payments E114-E118 | Out of IntelForm scope | A template-level audit |
| Store "data note" and screenshots | They live in the developer portal | Portal access |
| Contents of the export-all ZIP beyond headers (api); larger-than-20k retention and file cleanup (performance) | Delegated to other areas | Partly covered by requirements and data-concurrency |

**Process incident: rows that were written to the shared `site` database.** Before they noticed F-032, these auditors' dev servers wrote into `site`.

Already removed by the auditor who wrote them:
- security: 3 users plus 3 audit rows
- code-quality: 1 users, 1 pending_sign_ups and 1 audit_events row
- requirements: 1 pending_sign_ups row
- frontend-a11y: 1 pending_sign_ups row

**Still in `site`, to delete:**
- v6: `responses.id 91aac198-a5a2-4cc1-8e4b-b689f60693e1` (form `…f001`), plus probably that form's funnel counters.
- v8: `responses 41909b0b-d605-4c05-b5e0-76c8a0cf6b4b` and `df268586-9c34-4296-b9d5-e2e7a6aa7da1` (form how-are-we-doing), plus `form_events` ids 8 and 10-14.

Left in `site`; they expire by themselves:
- a few `login_attempts` rows (hashes only) and `intelform_rate_limits` rows from the api, data-concurrency, ops, privacy-legal, v4 and frontend-a11y runs

Every area and verifier reports that its own database was dropped `with (force)` and its processes were killed.

---

## 9. What is good (keep it; don't rewrite)

- **Submit pipeline.** A single CTE does the counter, cap, close-date and status check and the INSERT. It was exact under 40-way contention: the cap closes at exactly N, and reopening at the cap is refused.
- **Authorization.** 250 + 172 role checks matched the README matrix exactly. Cross-form IDOR returns 404, exports are scoped per user, and webhook secrets and password hashes are never exposed to viewers.
- **Tokens and SSRF.**
  - Render and unlock tokens are HMAC'd with HKDF purposes.
  - `assertSafeUrl` held against 30 bypass forms.
  - Webhooks use redirect:manual, a 10 s timeout and a 1 KB capped read.
  - Webhooks carry a correct Standard Webhooks HMAC and a stable webhook-id across retries.
- **Data integrity.**
  - Response delete, erase, form delete and retention keep counts, contacts and hours exact.
  - The form-delete cascade reaches every table.
  - Retention SQL is correct on real Postgres.
  - Keyset paging, trigram search and summaries all run at ≤ 40 ms DB time at 20k responses per form.
- **Output safety.**
  - CSV escaping handles BOM, CRLF and formula injection.
  - Theme CSS is escaped and hash-allowed by CSP. JSON-LD is escaped. There are no data-driven innerHTML sinks.
  - embed.js checks message origin and source.
  - Mail headers are normalised.
  - Logs contain no PII. Raw IPs are never stored (but see F-015).
- **Respondent UI.**
  - axe-clean in every layout, theme and width.
  - Error summary with aria-invalid/aria-describedby, a hidden honeypot, a "Type instead" alternative for signatures, and a single submit under double Enter.
- **Bundles.** Public pages ship 12-17 KB gz of JS. The portal's first load is within budget and every screen is lazy-loaded.
- **Secrets hygiene.** There are no real secrets in the tree or the history, and no source maps in the client.

---

## 10. Fix plan

The waves are ordered. Inside a wave, each lettered **track** touches a different set of files, so tracks can run in parallel. The arrows mark dependencies.

**Wave 0: release blocker (no code).** Merge the template upgrade when it is published. Do it after W3-A (F-020), or redo the 5 test edits by hand. Then re-run `node store-check.mjs` and `npm run platform -- check`. Remove `docs/audit/` (or its `.sh` files) from the submitted tree.

**Wave 1: stop the bleeding (lost responses and lost messages).**
- **W1-A** `src/server/app.ts`, `src/respondent/api.ts`, `src/respondent/upload.ts`:
  - F-001: mount the respondent routes before csrf.
  - F-005: per-route body limit for submit.
  - F-027 and F-036: onError mapping.

  One owner, because they share app.ts. Add the embed E2E from F-023 as this track's regression test.
- **W1-B** `src/server/intelform/notify/notify.ts`, `src/server/background.ts`, `submit.ts` (queue call only), plus a new additive migration for the outbox:
  - F-002: outbox and catch-up.
  - F-004: owner digest and 429 handling.
  - F-012: throw on a refused retry.
  - The server half of F-003: record the `no-provider` outcome.
- **W1-C** `src/server/routes/builder.ts`, `src/server/intelform/settings/settings.ts`, `src/portal/intelform/settings/delivery.tsx`, `src/portal/intelform/builder/settings/sections.tsx`, `WebhookSection.tsx`:
  - The capability flag and copy half of F-003.
  - The F-012 copy.
  - F-030.

  This track can start in parallel with W1-B. Agree the `mailConfigured` field name with W1-B first.
- **W1-D** `prisma/migrations/20261116150000_review_fixes`: F-009. Confirm first whether this migration was ever applied to a live site. If it was, write an idempotent follow-up migration instead of editing the file.
- **W1-E** docs and dev tooling: F-032. Also delete the leftover rows in `site` (section 8).

**Wave 2: data integrity and privacy (each track → after W1-B where it touches submit.ts or background.ts).**
- **W2-A** `src/server/intelform/respondent/submit.ts`, `src/lib/intelform/api-public.ts`, `src/respondent/*`, a new migration (→ after W1-A and W1-B):
  - F-007: submissionId.
  - F-034: browser_token unique index.
  - F-013: map P2010 to 422.
  - F-015: stop storing ip_hash.
  - F-028: NUL and surrogate sanitising in the shared answer schema.
- **W2-B** `src/server/intelform/builder/publish.ts`, `PublishButton.tsx`: F-008.
- **W2-C** `contacts/query.ts`, `responses/table.ts`, `exports/job.ts`, `routes/exports.ts`, and the retention part of `background.ts` (→ after W1-B):
  - F-010: invalidate exports.
  - F-025: failed state for stale exports.
  - F-029: retention cache clears and the README fix.
- **W2-D** `src/server/routes/public-forms.ts`: F-006.
- **W2-E** audit events across `routes/forms.ts`, `responses.ts`, `contacts.ts`, `exports.ts`, `builder.ts`, `app-settings.ts`: F-011 (→ after W2-C, which shares contacts.ts and exports.ts).
- **W2-F** templates and the privacy page: `src/lib/intelform/form/templates/index.ts`, `types/advanced.ts`, `src/pages/f/[slug].astro`, `settings/site.tsx`: F-014.

**Wave 3: make the gate real (can start in parallel with wave 2; it touches tests and config only).**
- **W3-A** `tests/integration/support/*`, a new app-owned reset helper, DEVELOPERS.md: F-020 (→ before Wave 0's merge).
- **W3-B** `package.json` scripts, `vitest.config.ts`, oxlint config:
  - F-021: integration tests in check.
  - F-022: typecheck.
  - F-054: lint.
  - F-048: coverage pool.
  - F-024: `npm audit fix`.
  - F-053: install scripts.
- **W3-C** an E2E suite (new `e2e/`): F-023, porting the legacy Playwright specs including the cross-site embed (→ after W1-A).
- **W3-D** F-016 per-contact export (→ after W2-C and W2-E). F-057 font licences. F-019, to recheck after the template merge. F-052, to report upstream.

**Wave 4: polish, accessibility, performance and maintainability (all parallel by file).**
- **W4-A** respondent first paint and the budget check: F-017.
- **W4-B** builder: F-018, F-039, F-043, F-044, F-045, F-046, F-056.
- **W4-C** contacts and settings UI: F-040, F-041, F-042.
- **W4-D** webhooks: F-026, F-037 (→ after W1-B).
- **W4-E** server odds and ends: F-031, F-035, F-049, F-050, F-051, F-055.
- **W4-F** data: F-033 (a trigger migration).
- **W4-G** cleanup: F-038, F-047, F-058.

---

## 11. Fix status

| id | status | note |
|---|---|---|
| F-001 | open | |
| F-002 | open | |
| F-003 | open | |
| F-004 | open | |
| F-005 | open | |
| F-006 | open | |
| F-007 | open | |
| F-008 | open | |
| F-009 | open | |
| F-010 | open | |
| F-011 | open | |
| F-012 | open | |
| F-013 | open | |
| F-014 | open | |
| F-015 | open | |
| F-016 | open | |
| F-017 | open | |
| F-018 | open | |
| F-019 | open | |
| F-020 | open | |
| F-021 | open | |
| F-022 | open | |
| F-023 | open | |
| F-024 | open | |
| F-025 | open | |
| F-026 | open | |
| F-027 | open | |
| F-028 | open | |
| F-029 | open | |
| F-030 | open | |
| F-031 | open | |
| F-032 | open | |
| F-033 | open | |
| F-034 | open | |
| F-035 | open | |
| F-036 | open | |
| F-037 | open | |
| F-038 | open | |
| F-039 | open | |
| F-040 | open | |
| F-041 | open | |
| F-042 | open | |
| F-043 | open | |
| F-044 | open | |
| F-045 | open | |
| F-046 | open | |
| F-047 | open | |
| F-048 | open | |
| F-049 | open | |
| F-050 | open | |
| F-051 | open | |
| F-052 | open | |
| F-053 | open | |
| F-054 | open | |
| F-055 | open | |
| F-056 | open | |
| F-057 | open | |
| F-058 | open | |

---

## Appendix A: system map

Map files (read-only code trace, 2026-11-16):
- [product.md](audit/evidence/map/product.md): product summary, top 5 things that must never go wrong, threat model, and promises to check
- [endpoints.md](audit/evidence/map/endpoints.md): global middleware order, every page and /site-api endpoint with guards and side effects, and mapping-time leads
- [data-state-jobs.md](audit/evidence/map/data-state-jobs.md): data model, triggers, state machines T1-T31, background jobs, outside services, platform limits
- Map-time probes: `cascade-delete.sql/.out`, `contacts-race*.sh/.out`, `notify-job-refused.test.ts`

Global middleware order on /site-api (src/server/app.ts:62-77):
1. Platform deliveries E1/E2 are handled before Hono.
2. Astro middleware sets the security headers (`X-Frame-Options: DENY`; on /f/* it is overridden by CSP `frame-ancestors *`).
3. previewCookies.
4. sameOrigin.
5. `/checkout`, mounted before csrf.
6. **csrf**: double-submit with a SameSite=Lax cookie. This step is the root of F-001.
7. bodyLimit: 64 KB, or 512 KB for PATCH /forms/:id. This is the root of F-005.
8. Permission sync, then the routes.

### A.1 Endpoints and audit coverage

| id | endpoint | coverage | note |
|---|---|---|---|
| E1 | POST /site-api/_platform/jobs | Code trace | jobs run inline locally; handlers exercised in-process, platform delivery not |
| E2 | POST /site-api/_platform/payments | Not reviewed | template payments/memberships, unused by IntelForm |
| E3 | GET /health | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E4 | GET /me | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E47 | GET /site | Live |  |
| E5 | GET /auth/csrf | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E6 | POST /auth/register | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E7 | POST /auth/register/verify | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E8 | POST /auth/resend-verification | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E9 | POST /auth/verify-email | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E10 | POST /auth/login | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E11 | POST /auth/login/two-factor | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E12 | POST /auth/refresh | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E13 | POST /auth/logout | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E14 | POST /auth/logout-all | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E15 | GET /auth/me | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E16 | PATCH /auth/me | Live | sign-up/sign-in used by every area; E16 malformed-body sweep |
| E17 | POST /auth/forgot-password | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E18 | POST /auth/reset-password | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E19 | POST /auth/change-password | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E20 | POST /auth/code | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E21 | POST /auth/code/verify | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E22 | GET /auth/owner?ticket=&next= | Not possible | owner "View as admin" cannot run locally |
| E23 | POST /auth/owner | Not possible | owner "View as admin" cannot run locally |
| E24 | GET /auth/two-factor | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E25 | POST /auth/two-factor/setup | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E26 | POST /auth/two-factor/enable | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E27 | POST /auth/two-factor/disable | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E28 | POST /auth/two-factor/recovery-codes | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E29 | POST /auth/email | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E30 | POST /auth/email/confirm | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E31 | POST /auth/email/cancel | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E32 | GET /auth/sessions | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E33 | DELETE /auth/sessions/:id | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E34 | POST /auth/delete-account | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E35 | GET /admin/users?before=&email=&status= | Live | role matrix / permissions listing |
| E36 | GET /admin/users/:id | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E37 | PATCH /admin/users/:id | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E38 | PUT /admin/users/:id/roles | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E39 | POST /admin/users/:id/sessions/revoke | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E40 | POST /admin/users/:id/two-factor/disable | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E41 | GET /admin/roles | Live | role matrix / permissions listing |
| E42 | GET /admin/permissions | Live | role matrix / permissions listing |
| E43 | POST /admin/roles | Live | role matrix / permissions listing |
| E44 | PATCH /admin/roles/:slug | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E45 | DELETE /admin/roles/:slug | Not reviewed | template-owned auth/admin, out of IntelForm scope |
| E46 | GET /admin/audit?before= | Live | role matrix / permissions listing |
| E48 | PATCH /forms/:id (alias /builder/forms/:id) | Live |  |
| E49 | POST /forms/:id/publish (alias) | Live |  |
| E50 | GET /forms/:id/versions (alias) | Live |  |
| E51 | GET /forms/:id/versions/:version (alias) | Live |  |
| E52 | GET /forms | Live |  |
| E53 | GET /forms/strip | Live |  |
| E54 | GET /forms/recent-responses | Live |  |
| E55 | GET /forms/prefs/view | Live |  |
| E56 | PATCH /forms/prefs/view | Live |  |
| E57 | POST /forms | Live |  |
| E58 | GET /forms/:id | Live |  |
| E59 | POST /forms/:id/close | Live |  |
| E60 | POST /forms/:id/reopen | Live |  |
| E61 | POST /forms/:id/duplicate | Live |  |
| E62 | POST /forms/:id/save-as-template | Live |  |
| E63 | DELETE /forms/:id | Live |  |
| E64 | GET /builder/capabilities | Live |  |
| E65 | POST /builder/forms/:id/presence | Live |  |
| E66 | DELETE /builder/forms/:id/presence/:tabId | Live |  |
| E67 | GET /builder/forms/:id/webhook | Live |  |
| E68 | PUT /builder/forms/:id/webhook | Live |  |
| E69 | DELETE /builder/forms/:id/webhook | Live |  |
| E70 | POST /builder/forms/:id/webhook/secret | Live |  |
| E71 | POST /builder/forms/:id/webhook/test | Live |  |
| E72 | GET /builder/forms/:id/webhook/deliveries | Live |  |
| E73 | GET /builder/forms/:id/webhook/deliveries/:deliveryId | Live |  |
| E74 | POST /builder/forms/:id/webhook/deliveries/:deliveryId/resend | Live |  |
| E75 | GET /builder/teammates | Live |  |
| E77 | GET /templates | Live |  |
| E78 | PATCH /templates/:id | Live |  |
| E79 | DELETE /templates/:id | Live |  |
| E80 | GET /themes | Live |  |
| E81 | GET /themes/presets | Live |  |
| E82 | POST /themes | Live |  |
| E83 | DELETE /themes/:id | Live |  |
| E84 | GET /responses/forms/:id/responses/prefs | Live |  |
| E85 | PUT /responses/forms/:id/responses/prefs | Live |  |
| E86 | GET /responses/forms/:id/responses | Live |  |
| E87 | POST /responses/forms/:id/responses/bulk-delete | Live |  |
| E88 | GET /responses/forms/:id/responses/:rid | Live |  |
| E89 | DELETE /responses/forms/:id/responses/:rid | Live |  |
| E90 | GET /responses/forms/:id/summary | Live |  |
| E91 | GET /public/forms/:slug | Live |  |
| E92 | POST /public/forms/:slug/unlock | Live |  |
| E93 | POST /public/forms/:slug/events | Live |  |
| E94 | POST /public/forms/:slug/responses | Live |  |
| E95 | GET /contacts | Live |  |
| E96 | GET /contacts/overview | Live |  |
| E97 | GET /contacts/detail?key= | Live |  |
| E98 | POST /contacts/delete | Live |  |
| E99 | POST /exports | Live |  |
| E100 | GET /exports/:id | Live |  |
| E101 | GET /exports/:id/download | Live |  |
| E102 | POST /uploads | Partial | malformed input + 503 storage_not_configured only (no platform files locally) |
| E103 | POST /uploads/:fileId/complete | Code trace | needs platform files |
| E104 | POST /uploads/signature | Partial | refusals only (draft 404, malformed, rate limit); happy path needs platform files |
| E105 | GET /uploads/signatures/:responseId/:fieldId | Partial | authorization matrix only; no stored signature locally |
| E106 | GET /app-settings | Live |  |
| E107 | PATCH /app-settings | Live |  |
| E108 | POST /app-settings/spam/test | Live |  |
| E109 | GET /public-site/app | Live |  |
| E110 | GET /public-site/home | Live |  |
| E111 | GET /public-site/forms?search=&after= | Live |  |
| E112 | GET /public-site/legal/:kind | Live |  |
| E113 | GET /public-site/sitemap | Live |  |
| E114 | POST /checkout | Not reviewed | template payments/memberships, unused by IntelForm |
| E115 | GET /checkout/gateways?price= | Not reviewed | template payments/memberships, unused by IntelForm |
| E116 | GET /checkout/:id | Not reviewed | template payments/memberships, unused by IntelForm |
| E117 | GET /memberships | Not reviewed | template payments/memberships, unused by IntelForm |
| E118 | POST /memberships/:id/cancel | Not reviewed | template payments/memberships, unused by IntelForm |


### A.2 State transitions and audit coverage

| id | transition | coverage | note |
|---|---|---|---|
| T1 | Form ∅ → draft (create, template, duplicate) | Live | requirements, api, frontend |
| T2 | Draft autosave (revision, If-Match) | Live | requirements, frontend |
| T3 | draft → live (publish, idempotency) | Live | F-008 race found |
| T4 | live → closed (manual) | Live |  |
| T5 | closed → live (reopen, cap 409) | Live |  |
| T6 | live → closed (cap reached, atomic) | Live | 40-way race exact |
| T7 | live → closed (closeAt passed; hourly job) | Live | read-time + maintenance on real PG |
| T8 | slug change / old slug redirect | Live |  |
| T9 | form delete (typed title, cascade) | Live | 19.5k-response cascade under 30 concurrent submits |
| T10 | response submit | Live | F-001, F-005, F-007, F-013, F-034 |
| T11 | response delete (single/bulk) | Live | overlapping deletes exact |
| T12 | contact erase | Live | F-010 |
| T13 | retention erase | Live | real applyRetention on Postgres; F-010, F-029 |
| T14 | webhook first attempt | Live | ops fake receiver |
| T15 | webhook retryable failure → retry | Live | same webhook-id |
| T16 | webhook non-retryable failure | Live | 302 not followed |
| T17 | webhook retry send refused → failed | Proof test (hosted mode) | F-012 |
| T18 | Test/Resend delivery | Live | 8 concurrent resends share webhook-id; F-026 |
| T19 | export ∅ → running | Live | rate limit 10/10 min exact |
| T20 | export running → running (parts) | Live | 20k rows in 4 parts |
| T21 | export running → ready | Live |  |
| T22 | export running → failed | Code trace | F-025 (no failed state on retry exhaustion) |
| T23 | export sweep (24 h) | Live | hourly maintenance on real PG |
| T24 | signature ∅ → pending | Partial | refusals only; no platform files |
| T25 | signature pending → claimed | Not run | needs platform files |
| T26 | signature claimed → trash | Live | trash rows written on delete/erase |
| T27 | trash → deleted from storage | Not run | needs platform files |
| T28 | trash → abandoned after 5 failures | Code trace | map lead F2 (Likely), not verified |
| T29 | contact created/updated (insert trigger) | Live |  |
| T30 | contact recomputed (delete trigger) | Live | F-033 race at DB level |
| T31 | contact erased | Live |  |


Jobs (background.json): `intelform-response-notify`, `intelform-webhook-deliver` (retries 4), `intelform-webhooks` (Test/Resend), `intelform-exports` (retries 3), `intelform-file-cleanup`, `intelform-retention` (daily 04:30 UTC), `intelform-maintenance` (hourly). There are 7 lists and 2 schedules. The platform default is 10 jobs added per minute per site (docs/agent/background-jobs.md:143).

## Appendix B: product summary and threat model

**Product.** IntelForm is a single-business form and survey builder sold as an EzyStudio store listing and installed as the customer's own site. These people use it:
- **The owner**: the paying customer, who reaches the app only through "View as admin".
- **Teammates**: Admins, Editors and Viewers. They build forms, read responses, and manage contacts and exports in /dashboard.
- **Anonymous respondents**: they fill /f/<slug>/ directly, in an inline iframe or popup on any third-party site, or from the public hub.

Data held:
- answers (free text, email, phone, address, date, signatures, files)
- contact roll-ups
- ip_hash, country, device, browser, browser token
- funnel events
- webhook delivery logs
- exports
- form password hashes and webhook secrets
- the template's users, sessions, TOTP and audit events

**Top 5 must-never-go-wrong**, from product.md:
1. A response is lost after "Thanks!". F-001 and F-005 broke this. F-002, F-003 and F-004 apply the same failure to messages.
2. Responses or secrets leak across the authorization boundary. Held: no violation in 420+ checks.
3. A deletion promise is broken. Partly broken by F-010 and F-029, with map lead F2 unverified.
4. The public form is down or unusable. Direct links held. The embed is broken (F-001). The form can be locked out (F-006).
5. Takeover or XSS via creator or respondent content. Held: escaping, CSP, SSRF and CSV checks all passed.

**Threat model (summary).**
- **Actors:** anonymous respondent, embedding third-party site, holder of a leaked form or response link, signed-in user with no role, Viewer, Editor, Admin, Owner, compromised webhook receiver, compromised mail provider.
- **Trust boundaries:**
  - the internet → /f/* and the public API (cf-connecting-ip is trusted)
  - the embedding page ↔ the iframe (postMessage, partitioned storage)
  - creator content → respondents, emails and redirects
  - respondent content → dashboard, exports, emails and webhooks
  - user → role gates
  - Worker → platform and the arbitrary internet (webhooks)
  - template core (`src/platform`) ↔ app code
- **Main tested attack surfaces:**
  - authorization and IDOR (held)
  - CSRF and embed (F-001: the protection over-blocks, it does not under-block)
  - password gate (F-006: DoS)
  - SSRF (held)
  - XSS and CSV injection (held)
  - rate limits and quotas (F-002 and F-004: quotas cause silent loss)
  - privacy (F-010, F-014, F-015, F-016, F-051)

The full actor table and the promises list are in [product.md](audit/evidence/map/product.md).

## Appendix C: refuted and downgraded claims (dropped or changed)

No finding was refuted in full, and no finding was dropped. These verifier results changed or narrowed a claim:
- **Webhook stacks drift (code-quality, filed Medium) → F-026, V↓ Low.** The headline scenario was refuted by v7: a header value with a trailing newline is dropped by both stacks, so "Send test passes while real deliveries 401" does not happen. What remains:
  - a NUL-byte difference, reachable through the API only
  - legacy map-form headers, which only the real path sends
  - silent dropping of a newline header that was saved with 200, which is folded into F-026's fix
- **Owner relay 429 (ops), sub-claim (b) Unconfirmed.** The claim was that anonymous respondents can exhaust the site's relay quota for sign-in codes. The per-recipient cap (5/h) should refuse owner notifications long before the site quota of 120/h, unless refused sends count against the site quota. That can't be checked locally. Part (a) is Confirmed, and F-004 stays High.
- **Map lead "two webhook pipelines may send duplicate deliveries"** (endpoints.md flag 12). It was not borne out: Test/Resend and real deliveries are separate pipelines, and resend reuses the webhook-id (data-concurrency race-webhook-resend.log). Only the drift in F-026 remains.
- **Map lead "E52 listQuery.parse throws → 500"** was not observed: the api sweep of malformed queries on E52 found no 500 except the NUL case (F-028).

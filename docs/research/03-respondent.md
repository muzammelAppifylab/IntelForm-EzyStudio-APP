# Research: respondent side (public form, embeds, spam)

Checked 2026-10-19. Versions and licences come from `npm view`. Sizes are min+gzip from bundlephobia, or marked "approx". Feeds [PLAN.md](../PLAN.md) phase 2 and phase 6.

## Decisions

| Need | Choice (version, licence, size) | Why | Runner-up |
|---|---|---|---|
| Phone + E.164 | **libphonenumber-js 1.13.15**, MIT. `/min` metadata in the browser (approx 35–45 KB, lazy chunk), `/max` on the server | A small custom input: `AsYouType` while typing, E.164 on blur. The server runs strict `isValidPhoneNumber`. | react-phone-number-input 3.4.18 (MIT): ready-made, but pulls in extra dependencies and CSS |
| Country names | **`Intl.DisplayNames({ type: 'region' })`** (0 KB) plus a static list of about 249 ISO alpha-2 codes | Localised names for free in every target browser. "Limit to a list" filters the array. | i18n-iso-countries 7.14.0 (MIT): slow maintenance |
| Flags | **country-flag-icons 1.6.20**, MIT, SVG, inside the lazy dropdown chunk | Emoji flags show as letters ("US") on Windows. | flag-icons 7.6.0 (MIT) |
| Date | **Masked text input in the chosen format + lazy react-day-picker popover** (v10.0.2, MIT, about 19 KB, uses date-fns 4) | A native date input always displays in the browser's locale, so it can't honour a DD/MM/YYYY setting. On touch devices, offer the native picker as an option. | Native input only, dropping the display format |
| Time | **Hour / minute (/ AM-PM) selects** built from the "step in minutes" setting. Store `HH:mm`. | A native time input picks 12/24 h from the OS and can't be forced. | Native `type=time` with `step` |
| Signature | **signature_pad 5.1.4**, MIT, about 4.5 KB, in our own small hook | Pointer events, touch, PNG export, redraw on resize. | perfect-freehand 1.2.3 (MIT). **Avoid react-signature-canvas**: a stale alpha on an old signature_pad. |
| Email syntax | **zod `z.email()`**, shared; the server lowercases and trims | Already in the stack. | — |
| Block free email domains | **free-email-domains 1.15.8**, MIT, **server only** (large list, updated daily) | Built from HubSpot plus disposable lists, checked against DNS. | mailchecker 6.0.21 (disposable only, doesn't block gmail.com) |
| Embed auto-resize | **Our own script: ResizeObserver + postMessage**, about 1.5 KB | **iframe-resizer v5 is GPL-3.0 or paid** (see licence flags). | iframe-resizer 4.4.5 (MIT, unmaintained) |
| QR codes (dashboard) | **qrcode 1.5.4**, MIT, about 8.5 KB | SVG string and PNG data URL out of the box. | uqr 0.1.3 (MIT, zero deps, SVG only) |
| Turnstile | **@marsidev/react-turnstile 1.6.2**, MIT, React 19 | Script loading, `execute`, `reset`, expiry callbacks. | Direct script plus our own ~50-line component |
| One response per browser | **First-party cookie + localStorage token**, plus a server-side "lite" hash. No client fingerprinting library. | Privacy-safer; see below. | @fingerprintjs/fingerprintjs 5.3.0 (MIT only from v5) |

**Dates.**
- Store a plain `"YYYY-MM-DD"` string. Never build it with `new Date(...).toISOString()`, which shifts the day across time zones.
- "Disable past / future" uses the respondent's local today. The server allows ±1 day of tolerance.
- Check that the shadcn Calendar works with react-day-picker v10; pin v9 if not.

**Signature accessibility.**
- Canvas gets `role="img"` and a label, `touch-action: none`, devicePixelRatio scaling, and a 44 px Clear button.
- "Draw only" fails WCAG 2.1.1 for keyboard users. **Open question:** add a "Type your name" option rendered to the canvas.

## Embed script

```js
// /embed.js: served from the app origin, about 1.5 KB, no dependencies
(() => {
  const ORIGIN = new URL(document.currentScript.src).origin
  // Inline: <iframe data-intelform src=".../f/slug?embed=1" style="width:100%;border:0">
  addEventListener('message', (e) => {
    if (e.origin !== ORIGIN) return
    if (e.data?.type === 'intelform:resize') {
      document.querySelectorAll('iframe[data-intelform]').forEach((f) => {
        if (f.contentWindow === e.source) f.style.height = e.data.height + 'px'
      })
    }
    if (e.data?.type === 'intelform:close') closeModal()
  })
  // Popup: <button data-intelform-popup="slug" data-color="#5B3FD9">Take survey</button>
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-intelform-popup]'); if (!b) return
    openModal(`${ORIGIN}/f/${b.dataset.intelformPopup}?embed=popup`)
    // <dialog>.showModal(), iframe 100%, max-width 720px, full screen under 640px,
    // Esc closes, focus returns to the button, body scroll locked
  })
})()
// Inside /f/:slug when ?embed is set:
// new ResizeObserver(() => parent.postMessage({ type: 'intelform:resize',
//   height: document.documentElement.scrollHeight }, '*')).observe(document.body)
```

The child posts to `'*'` because it can't know the host page, so it sends nothing but a height. The parent always checks `e.origin`.

**Headers.**
- `Content-Security-Policy: frame-ancestors *` and no X-Frame-Options go **only on `/f/*`** and `/embed.js`. Every other route gets `frame-ancestors 'self'` + `X-Frame-Options: DENY`.
- `frame-ancestors` only works as a response header, not in `<meta>`.

**Storage inside iframes.**
- Safari blocks third-party cookies. Chrome and Firefox partition cookies and storage by top-level site.
- So the password-unlock state uses a short-lived token kept in memory or sessionStorage, not a cookie.
- Wrap every storage access in try/catch (WebKit bug 299531).

## Spam pipeline (submit route, in order)

1. **Request checks.**
   - Body limit (256 KB without the signature) and JSON content type.
   - `/api/public/*` allows any origin and never sends credentials.
2. **Form checks.** Live, not past the close date, cap not reached, password token valid.
3. **Rate limit: 10 per minute per IP per form.**
   - Key = HMAC(secret rotated daily, ip + formId).
   - The IP is taken from `cf-connecting-ip` / `x-forwarded-for` **only when `TRUST_PROXY` is set**.
   - This runs before Turnstile, so floods don't use up verification calls.
4. **Honeypot + minimum time.**
   - An off-screen field with a random name, `aria-hidden`, `tabindex="-1"`, `autocomplete="off"`.
   - A signed render timestamp; reject anything under about 2 s.
   - On a hit, **return a fake success** and discard the submission.
5. **zod validation** against this form version. This runs before Turnstile because a Turnstile token works only once.
6. **Turnstile siteverify.**
   - Sends `secret`, `response`, `remoteip` and an idempotency key.
   - Checks `success`, `hostname`, and `action === 'submit'`.
   - Tokens last 300 s and work once. On `timeout-or-duplicate` the client resets and retries.
   - Fails closed.
7. **Dedupe:** one response per email, one per browser.
8. **Insert in one transaction**, re-checking the cap. Store the IP as HMAC(install salt, ip). Reply in under 500 ms.
9. **After the reply:** email and webhook.

**Turnstile client.**
- Use `execution: 'execute'` and `appearance: 'interaction-only'`, and execute on Submit, so long forms don't outlive the 300 s token.
- Load the script only for forms with Turnstile on.
- Test sitekeys:
  - `1x00000000000000000000AA`: passes.
  - `2x00000000000000000000AB`: fails.
  - `3x00000000000000000000FF`: forces a challenge.
- Test secrets:
  - `1x0000000000000000000000000000000AA`: passes.
  - `2x0000000000000000000000000000000AA`: fails.

## One response per browser

- **Token.**
  - After a successful submit, set a first-party `if_r_<formId>` cookie (SameSite=Lax, 1 year) and mirror it in localStorage.
  - The next submit sends it, and the server stores HMAC(salt, formId|token).
- **Lite hash (no client code).**
  - The server computes HMAC(salt, formId | User-Agent | Accept-Language | IP /24 or /48).
  - It blocks only within about 24 h when there is no token, so an office behind one NAT isn't locked out.
  - The UI labels this a "soft limit".
- **Inside embeds**, the token is partitioned per host site. Document this.
- **FingerprintJS.**
  - v4 is **BUSL-1.1**; v5 is MIT.
  - Not recommended: modest accuracy, about 40 KB, and EDPB Guidelines 2/2023 treat fingerprinting as needing consent.
  - A cookie set only after submit, for a feature the creator turned on, is easier to justify.
  - Setting help text should tell the creator to mention it in their privacy notice.

## Accessibility checklist (all three layouts)

- **Focus.** On each step, move focus to the new question's heading (`<h2 tabindex="-1">`), not the input. The same applies to the start screen, end screen and closed message.
- **Grouping.** `<fieldset>` + `<legend>` for choice, rating and NPS. Native radio and checkbox semantics, arrow keys inside radio groups.
- **Errors.**
  - `aria-invalid` + `aria-describedby` on the field, with the field's message as `role="alert"`.
  - Focus moves to the first invalid field.
  - One polite live region for "Step 3 of 8".
- **Progress bar.** `role="progressbar"` with `aria-valuenow` / `aria-valuemax` / `aria-valuetext`.
- **Enter key.**
  - Enter advances only from single-line inputs.
  - In a long text field, Shift+Enter is a newline and Cmd/Ctrl+Enter advances.
- **No global single-letter shortcuts.** A/B/C keys clash with screen-reader navigation (WCAG 2.1.4). If added, they apply only while focus is in the option group.
- **Auto-advance (300 ms) only after a pointer click**, never after a keyboard or arrow selection. Otherwise arrowing through radios jumps pages (WCAG 3.2.2).
- **Reduced motion.** `prefers-reduced-motion` gives an instant swap.
- **Touch targets.** 44 × 44 px minimum. NPS 0–10 wraps to two rows under 360 px.
- **Inputs.**
  - 16 px text so iOS doesn't zoom.
  - Correct `inputmode` / `autocomplete` (`email`, `tel`, `given-name`, `postal-code`, `country`).
  - `enterkeyhint="next"` or `"done"`.
- **On-screen keyboard.**
  - One-at-a-time uses `100dvh`.
  - Listen to `visualViewport` resize, keep the OK button above the keyboard, and `scrollIntoView({ block: 'center' })` on focus.
- **Language and title.** `<html lang>` comes from a per-form setting. The document title reads "Question 3 of 8 – Form title".

## Performance budget for /f/:slug (under 1.5 s on 4G)

**Separate entry.**
- Vite builds two inputs: `index.html` (dashboard) and `form.html` (respondent).
- The server serves `form.html` for `/f/*` with the **form JSON inlined** as `<script type="application/json" id="__FORM__">`, so there's no extra round trip.
- The respondent entry must never import the router, TanStack Query, dnd-kit, charts or dashboard UI. Enforce this with a lint rule and a bundle-size check in CI.

**Budget (gzip).**

| Item | Size |
|---|---|
| HTML with inlined JSON | ≤ 15 KB |
| Respondent CSS | ≤ 15 KB |
| Initial JS: React + renderer + validation | **≤ 110 KB** |

Phone (~40 KB), calendar (~20 KB), signature (~5 KB), flags and Turnstile load only when the form uses them.

**zod.** Full zod 4 adds roughly 15 KB or more. Write the shared schemas in **`zod/mini`**, which tree-shakes to a few KB and also works on the server. **Decide before building the registry.**

**Fonts and images.**
- Fonts: system stack by default. A theme font is self-hosted, latin subset, `font-display: swap`, and only that one is preloaded.
- Images: Bunny-resized with width and height set. The start image gets `fetchpriority="high"`; option images use `loading="lazy"`.

**Targets.** LCP ≤ 1.5 s on Lighthouse "Slow 4G" mobile, CLS < 0.05.

## Licence red flags

- **iframe-resizer v5: GPL-3.0 or paid** (an installable product needs OEM terms). Don't ship it; write the custom script.
- **@fingerprintjs/fingerprintjs 4.x: BUSL-1.1.** Only 5.x is MIT. We aren't using it.
- **free-email-domains** is MIT, but its HubSpot source list has no explicit licence. Low risk; mention it in third-party notices.
- **Turnstile** is a Cloudflare service under its own terms. Buyers supply their own keys.
- Everything else above is MIT.

Sources: [iframe-resizer pricing](https://iframe-resizer.com/pricing/) · [Turnstile testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) · [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) · [FingerprintJS 5.0 MIT](https://fingerprint.com/blog/fingerprintjs-version-5-0-mit-license/) · [free-email-domains](https://github.com/Kikobeats/free-email-domains) · [WebKit bug 299531](https://bugs.webkit.org/show_bug.cgi?id=299531) · npm registry

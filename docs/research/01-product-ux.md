# Research: how the best form builders do it

Checked 2026-10-19. We looked at Typeform, Tally, Fillout, Jotform Cards, Formbricks, HeyForm, OpnForm, Youform and Google Forms, reading the open-source ones' code on GitHub. Each point maps to a PRD section. Feeds [PLAN.md](../PLAN.md).

## 1. Builder (PRD "Form builder", "Logic")

What others do:
- **Tally:**
  - `/` on the canvas opens a filtered block list; `@` inserts an earlier answer.
  - Shortcuts: Esc selects a block, arrows move between blocks, Cmd/Ctrl+Shift+↑/↓ moves a block, Cmd/Ctrl+D duplicates, Cmd/Ctrl+Shift+R toggles required ([shortcuts](https://tally.so/help/keyboard-shortcuts)).
- **Formbricks:** the `@` menu lists only earlier questions and asks for a fallback right after you pick one. The pipe is stored inline in the text, and the server validates references ([recall](https://formbricks.com/docs/surveys/general-features/recall)).
- **OpnForm:** logic lives on the target field. A pre-publish check reports invalid references, missing conditions and missing actions.
- **Typeform:** logic sits in a separate Workflow panel with a graph ("Logic Map").
- **HeyForm:** keeps separate draft and published logic arrays.

**Adopt**
- **Three ways to add a field:**
  - click in the palette (appends);
  - drag (places it where you drop);
  - type `/` on the canvas (inserts below the selected field, reusing the palette search). The `/` route matters most for keyboard users.
- **Where editing happens:**
  - Label, description and option labels are edited **on the canvas**.
  - Required, validation, logic and type settings stay in the right panel.
- **Extra shortcuts:** Cmd+Shift+↑/↓ (move field) and Cmd+Shift+R (toggle required), next to the PRD's arrows, Delete and Cmd+D.
- **Pipe fallback:**
  - Ask for it in a popover as soon as a chip is inserted.
  - Store it inside the token: `{f_8k2m.first|there}`.
- **`@` menu** lists only fields above the current one, the same rule as logic.
- **Rules as sentences:** show each rule on the canvas card as plain text, e.g. "Shown when NPS ≤ 6". Tally is criticised for hidden logic.
- **Integrity check before Publish:** catch deleted references, a source now below its target, and empty rules. Block Publish and list the problems.

**Avoid**
- A separate logic panel or graph: single-level show/hide doesn't need one.
- Separate draft and published logic arrays.

**Open question:** should section breaks be collapsible on the canvas for long section-by-section forms?

## 2. One-at-a-time renderer (PRD "Layout modes")

**Adopt**
- **Keys:**
  - Enter advances.
  - In long text, Shift+Enter is a newline and Cmd/Ctrl+Enter advances.
  - Ignore Enter during IME composition, while a dropdown is open, or when an inner control already handled it (HeyForm's `useEnterKey`).
- **Letter keys (A/B/C)** work only while letters are visible and focus is in the option group. They are turned off while the "Other" text box has focus.
- **Auto-advance after 300 ms on single-choice types.**
  - A randomised study (n=807) found it about 33% faster with no loss of data quality, as long as Back stays available ([study](https://escholarship.org/uc/item/3557w1mn)).
  - OK and Back are always visible.
  - Never auto-advance multi-select.
- **Transition:** 250–350 ms vertical slide or fade, turned off under reduced motion.
- **Progress:**
  - Count only currently visible fields.
  - Hide the bar on very short forms (Jotform shows it from 4 cards).
- **Mobile keyboard** (the top Typeform mobile complaint):
  - Keep OK above the keyboard with `visualViewport`.
  - Add `interactive-widget=resizes-content` to the viewport meta.
  - Scroll the input into view on focus.
- **Mobile focus:** don't auto-focus inputs on touch devices, because it pops the keyboard over the question. Focus the question heading instead, and focus inputs only on desktop.

**Avoid:** swipe navigation (accidental back) and an OK button that can't be turned off.

**Open question:** make auto-advance a per-form toggle (default on)? It also helps with WCAG 3.2.2.

## 3. Section-by-section and all-at-once validation

**Adopt**
- **When to validate:**
  - Validate on Next / Submit, not on each keystroke.
  - After the first failed attempt, re-check fields as they change so errors clear at once.
  - Never disable Submit (GOV.UK pattern).
- **All-at-once errors:**
  - Show an **error summary** at the top, with one link per error.
  - Move focus to the summary and prefix the page title with "Error:".
  - This replaces the PRD's "focus the first invalid field" for this layout only. Paged layouts keep it.
- **Inline errors** go under the label and above the input, linked with `aria-describedby` and `aria-invalid`.
- **Scrolling:** `scrollIntoView({ block: 'center' })` with a header offset, not smooth under reduced motion.

**Avoid:** `role="alert"` on the summary while also moving focus to it, because screen readers read it twice.

## 4. Results (PRD "Responses and analytics")

What others do:
- **Typeform:** cards for Views, Starts, Submissions, Completion rate and Average time, plus per-question drop-off.
- **Tally:** shows NPS and CSAT automatically.
- **Formbricks:** stores per-question time-to-complete (`ttc`) on each response.
- **Google Forms:** the individual view has no search, and users complain about it.

**Adopt**
- **Per-question time.** Store a `ttc` map (field id → ms) on each response at submit. It's measured in the browser, so no partial responses are needed, and each card can show median time per question.
- **Scores.**
  - NPS shows the score on a −100…100 scale plus the response count.
  - 5-star ratings show CSAT % automatically.
- **Response drawer:** ←/→ and J/K for previous / next.
- **Charts filter the table.** Clicking a bar on a choice card opens the table filtered to that option.

**Avoid:** calling Views → Starts → Responses a "drop-off" chart. Without per-question reach data it's a 3-step funnel, so label it that way.

**Open question:** add a `reach` event per question (field id only, no answer content) for real per-question drop-off? It doesn't store partial answers, but it adds one event per step.

## 5. Share and embed

**Adopt**
- **Inline embed options:** "Transparent background" and "Hide title", as URL parameters.
- **Stable snippet:** it contains only the slug, and the theme loads at runtime. Theme changes never need a re-paste, which is Tally's pitfall.
- **Popup on phones** opens full screen under about 640 px.
- **QR code:** print the short URL as text under it; use high error correction.
- **Link preview:** with no OG image uploaded, generate one from the title, logo and theme colours, so links never show a blank card.

**Avoid:** slider, side-tab, popover and timed / exit-intent triggers (out of scope, lots of script code).

**Open question:** a "Full page" embed preset (a 100vh iframe)? It costs almost nothing.

## 6. Pitfalls users report

- **Response caps that lock people out** (Typeform's top complaint). IntelForm has no limits; say so in the marketing copy.
- **Broken CSV exports.** Add a UTF-8 BOM, escape formulas (`= + - @`), keep column order stable across versions, and test with 10,000 rows.
- **Weak theme control** (Tally, Fillout). Presets must look finished.
- **Logic users can't see.** Solved by rule sentences on the canvas cards.
- **Confusing Back on mobile.** Use an explicit Back button and no gestures.

## 7. Accessibility for conversational forms

Typeform is the warning case: labels weren't exposed to screen readers, and choice fields couldn't be operated ([a11y.reviews](https://github.com/a11y-reviews/a11y.reviews)).

**Adopt**
- **Native controls.** Choices are real `<fieldset>`/`<legend>` with native radios or checkboxes. Rating and NPS are radio groups whose labels include the scale ends ("0, Not likely").
- **Letter badges** are `aria-hidden`; options carry `aria-keyshortcuts`.
- **Steps are announced.** A polite live region says "Question 3 of 8", and focus moves to the question heading.
- **Auto-advance warning (WCAG 3.2.2).**
  - Add hidden hint text, "Choosing an answer moves to the next question".
  - Turn auto-advance off after keyboard use (the respondent pressed Tab).
- **Pre-publish accessibility check** (like Typeform's), in addition to contrast:
  - a hidden label with no accessible name;
  - a picture option with no alt text;
  - a start image with no alt text.
- **Recommendation:** warn the creator that one-at-a-time with auto-advance is the hardest layout to make accessible. Don't switch layouts silently.

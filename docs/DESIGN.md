# IntelForm design system v2.1 "paper & ink" (stable), for the EzyStudio private multi-layout survey form builder template.
# Treat every value below as a hard constraint for UI work.
# Import styles.css, then motion.css, instead of recreating these tokens. tokens.json holds the same values in DTCG format.
# Changes are recorded in docs/DESIGN-CHANGELOG.md; third-party licences are in NOTICE.

taste:
  id: intelform
  name: IntelForm design system
  version: "2.1"
  status: stable
  released: 2026-10-20
  changelog: docs/DESIGN-CHANGELOG.md
  summary: >-
    Paper & ink: an oat paper canvas, warm violet-black ink type and borders, periwinkle actions
    edged in 2px ink, pine green confirmations, and a single persimmon live accent. A large regular
    weight serif carries headings; a friendly geometric sans carries every control. Shadowless.
  inspired_by: editorial "broadsheet" product sites (cream canvas, display serif, ink borders), re-coloured with IntelForm's own palette (no colour values copied from reference sites)
  app_type: WEB_APP
  project_types: [private-tool, form-builder]
  styles: [editorial, warm, calm]
  theme:
    default_mode: LIGHT_MODE
    dark_mode: supported (class="dark" on <html>)
    palette_note: >-
      11-step OKLCH ramps (50-950); each anchor is kept exactly. Paper is the canvas family, ink the
      text/border family, periwinkle the action family, pine the confirmation family.
    palettes:
      paper:
        anchor: { step: '50', hex: '#F5F2EA' }
        description: "Oat paper neutral: canvas, quiet borders, muted text."
        ramp:
          '50': '#F5F2EA'
          '100': '#EAE8E3'
          '200': '#DAD8D2'
          '300': '#C3C0BA'
          '400': '#A6A39C'
          '500': '#8B8881'
          '600': '#716E67'
          '700': '#5A5851'
          '800': '#45433D'
          '900': '#302E29'
          '950': '#1D1B17'
      ink:
        anchor: { step: '950', hex: '#211D2A' }
        description: "Warm violet-black ink: text, 2px signature borders, dark chambers."
        ramp:
          '50': '#F8F5FE'
          '100': '#EEEBF8'
          '200': '#DEDAE9'
          '300': '#C7C2D2'
          '400': '#A9A5B5'
          '500': '#8F8A9A'
          '600': '#747080'
          '700': '#5E5A68'
          '800': '#484552'
          '900': '#34313C'
          '950': '#211D2A'
      periwinkle:
        anchor: { step: '200', hex: '#C9C0FF' }
        description: "IntelForm periwinkle: primary action fill and selection; deep steps for links and focus."
        ramp:
          '50': '#F6F6FE'
          '100': '#E5E2FE'
          '200': '#C9C0FF'
          '300': '#B4A5FE'
          '400': '#9B80FB'
          '500': '#8462E9'
          '600': '#6C48CA'
          '700': '#5737A8'
          '800': '#432984'
          '900': '#2F1C5F'
          '950': '#1D0F3F'
      pine:
        anchor: { step: '700', hex: '#2F5D46' }
        description: "Pine green: Live badge, confirmations, NPS promoters (also success)."
        ramp:
          '50': '#F2F9F5'
          '100': '#E3F0E8'
          '200': '#C9E2D4'
          '300': '#A6CCB7'
          '400': '#7EAF94'
          '500': '#5D9377'
          '600': '#42765C'
          '700': '#2F5D46'
          '800': '#224735'
          '900': '#173325'
          '950': '#0C1F16'
      persimmon:
        anchor: { step: '500', hex: '#E8613F' }
        description: "Persimmon: the live accent, once per screen."
        ramp:
          '50': '#FEF4F2'
          '100': '#FEE8E2'
          '200': '#FFD3C7'
          '300': '#FEB29E'
          '400': '#FE8363'
          '500': '#E8613F'
          '600': '#C54422'
          '700': '#A23112'
          '800': '#7D2208'
          '900': '#591604'
          '950': '#390800'
      raspberry:
        anchor: { step: '600', hex: '#C43358' }
        description: "Errors and destructive actions."
        ramp:
          '50': '#FFF4F5'
          '100': '#FEE6E9'
          '200': '#FECFD4'
          '300': '#FFA9B5'
          '400': '#FD758E'
          '500': '#E55071'
          '600': '#C43358'
          '700': '#A12144'
          '800': '#7D1633'
          '900': '#590D22'
          '950': '#390312'
      ochre:
        anchor: { step: '500', hex: '#D9961A' }
        description: "Warnings and rating stars."
        ramp:
          '50': '#FEF5EA'
          '100': '#FDEDD6'
          '200': '#FDDEB3'
          '300': '#F8C883'
          '400': '#EAAD4F'
          '500': '#D9961A'
          '600': '#B07701'
          '700': '#8C5E02'
          '800': '#694602'
          '900': '#492F01'
          '950': '#2A1A01'
      info:
        anchor: { step: '500', hex: '#2F7CF6' }
        description: "Chart series 5 only."
        ramp:
          '50': '#F2F7FF'
          '100': '#E2EDFE'
          '200': '#C6DCFE'
          '300': '#9BC1FF'
          '400': '#639FFF'
          '500': '#2F7CF6'
          '600': '#1361D6'
          '700': '#054DB2'
          '800': '#023A8C'
          '900': '#022965'
          '950': '#001842'
    colors:
      background:
        light: "paper/50"
        dark: "#17151D"
        use: "Page canvas: warm paper. Dashboard, builder canvas, front page."
      foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Body text and headings on background, card, muted."
      card:
        light: "#FDFCF9"
        dark: "#221F2A"
        use: "Cards and panels. Always with a 1px border."
      card-foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Text on card."
      popover:
        light: "#FDFCF9"
        dark: "#221F2A"
        use: "Menus, selects, dialogs. The only surfaces with a shadow."
      popover-foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Text on popover."
      primary:
        light: "periwinkle/200"
        dark: "periwinkle/200"
        use: "Primary action fill: soft periwinkle, always with a 2px ink border."
      primary-foreground:
        light: "ink/950"
        dark: "ink/950"
        use: "Label on primary (ink in both modes)."
      primary-hover:
        light: "periwinkle/300"
        dark: "periwinkle/300"
        use: "Hover / pressed primary."
      primary-border:
        light: "ink/950"
        dark: "paper/50"
        use: "2px edge of primary and secondary buttons."
      secondary:
        light: "#FDFCF9"
        dark: "#221F2A"
        use: "Outlined secondary button fill."
      secondary-foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Label on secondary."
      muted:
        light: "paper/100"
        dark: "#2A2638"
        use: "Quiet fills: table header, segmented control track, skeletons."
      muted-foreground:
        light: "paper/700"
        dark: "paper/300"
        use: "Helper text, captions, timestamps on background, card and muted."
      accent:
        light: "paper/100"
        dark: "#2A2638"
        use: "Hover surface for rows, menu items, ghost buttons."
      accent-foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Text on accent."
      link:
        light: "periwinkle/700"
        dark: "periwinkle/300"
        use: "Inline links (deep periwinkle)."
      destructive:
        light: "raspberry/700"
        dark: "raspberry/400"
        use: "Delete actions and error text."
      destructive-foreground:
        light: "#FFFFFF"
        dark: "ink/950"
        use: "Label on a destructive fill."
      border:
        light: "paper/200"
        dark: "#34304A"
        use: "Quiet 1px hairlines: cards, tables, dividers."
      border-ink:
        light: "ink/950"
        dark: "paper/50"
        use: "Signature 2px ink edge: buttons, selected states, key panels."
      input:
        light: "paper/500"
        dark: "paper/500"
        use: "1px form control outline, 3:1 on card in both modes."
      ring:
        light: "periwinkle/600"
        dark: "periwinkle/300"
        use: "2px focus ring with 2px offset."
      chamber:
        light: "ink/950"
        dark: "#0E0C15"
        use: "Dark \"chamber\" surface: KPI hero card, front page bands."
      chamber-foreground:
        light: "paper/50"
        dark: "paper/50"
        use: "Text on chamber."
      chamber-muted:
        light: "paper/300"
        dark: "paper/300"
        use: "Secondary text on chamber."
      highlight:
        light: "persimmon/500"
        dark: "persimmon/500"
        use: "Live accent (persimmon): new-response dot, today marker, recording state. Once per screen."
      highlight-foreground:
        light: "ink/950"
        dark: "ink/950"
        use: "Text on persimmon."
      pine:
        light: "pine/700"
        dark: "pine/300"
        use: "Brand secondary (pine green): Live badge, confirmations."
      pine-foreground:
        light: "paper/50"
        dark: "ink/950"
        use: "Text on pine."
      success-subtle:
        light: "pine/50"
        dark: "#0E2B27"
        use: "Success banner."
      success-subtle-foreground:
        light: "pine/700"
        dark: "pine/200"
        use: "Text on success-subtle."
      warning-subtle:
        light: "ochre/50"
        dark: "#33240A"
        use: "Warning banner, unpublished changes."
      warning-subtle-foreground:
        light: "ochre/700"
        dark: "ochre/300"
        use: "Text on warning-subtle."
      info-subtle:
        light: "periwinkle/50"
        dark: "#2A2140"
        use: "Tips and notices."
      info-subtle-foreground:
        light: "periwinkle/800"
        dark: "periwinkle/300"
        use: "Text on info-subtle."
      danger-subtle:
        light: "raspberry/50"
        dark: "#3A1018"
        use: "Error banner, invalid field message."
      danger-subtle-foreground:
        light: "raspberry/700"
        dark: "raspberry/300"
        use: "Text on danger-subtle."
      field:
        light: "#FDFCF9"
        dark: "#17151D"
        use: "Input background."
      field-placeholder:
        light: "paper/600"
        dark: "paper/400"
        use: "Placeholder text, 4.5:1 on field."
      option:
        light: "#FDFCF9"
        dark: "#221F2A"
        use: "Choice tile background."
      option-border:
        light: "paper/500"
        dark: "paper/500"
        use: "Choice tile outline at rest (3:1)."
      option-selected:
        light: "periwinkle/200"
        dark: "#3A2A5C"
        use: "Selected choice tile fill (periwinkle)."
      option-selected-border:
        light: "ink/950"
        dark: "periwinkle/300"
        use: "Selected tile edge, 2px."
      option-selected-foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Text in a selected tile."
      progress:
        light: "ink/950"
        dark: "periwinkle/300"
        use: "Respondent progress fill."
      progress-track:
        light: "paper/200"
        dark: "#34304A"
        use: "Progress track."
      rating:
        light: "ochre/400"
        dark: "ochre/400"
        use: "Filled rating star."
      rating-empty:
        light: "paper/400"
        dark: "paper/600"
        use: "Empty rating star."
      nps-detractor:
        light: "raspberry/500"
        dark: "raspberry/400"
        use: "NPS 0-6."
      nps-passive:
        light: "ochre/400"
        dark: "ochre/400"
        use: "NPS 7-8."
      nps-promoter:
        light: "pine/600"
        dark: "pine/400"
        use: "NPS 9-10."
      chart-1:
        light: "periwinkle/600"
        dark: "periwinkle/300"
        use: "First series (violet)."
      chart-2:
        light: "pine/600"
        dark: "pine/400"
        use: "Second series."
      chart-3:
        light: "persimmon/500"
        dark: "persimmon/500"
        use: "Third series."
      chart-4:
        light: "ochre/500"
        dark: "ochre/400"
        use: "Fourth series."
      chart-5:
        light: "info/600"
        dark: "info/400"
        use: "Fifth series."
      chart-6:
        light: "paper/500"
        dark: "paper/500"
        use: "Other."
      sidebar:
        light: "#FDFCF9"
        dark: "#221F2A"
        use: "Dashboard sidebar panel."
      sidebar-foreground:
        light: "ink/800"
        dark: "paper/200"
        use: "Sidebar text and icons."
      sidebar-accent:
        light: "periwinkle/200"
        dark: "#3A2A5C"
        use: "Active nav item fill (with 2px ink border)."
      sidebar-accent-foreground:
        light: "ink/950"
        dark: "paper/50"
        use: "Active nav item text."
      sidebar-border:
        light: "paper/200"
        dark: "#34304A"
        use: "Sidebar edge."
      shadow-color:
        light: "ink/950"
        dark: "#000000"
        use: "Tint for the one popover shadow."
    radius:
      sm: { value: 8px, use: "Checkboxes, chips, small tags." }
      md: { value: 12px, use: "Buttons, inputs, selects, segmented controls." }
      lg: { value: 20px, use: "Cards, panels, option tiles." }
      xl: { value: 32px, use: "Dialogs, front page form cards." }
      2xl: { value: 48px, use: "Front page chambers (dark bands)." }
      full: { value: 9999px, use: "Badges, pills, avatars, switches, progress bars." }
    borders:
      thin: { value: 1px, color: border, use: "Quiet hairlines on cards, tables, dividers." }
      ink: { value: 2px, color: border-ink, use: "Signature edge on primary and secondary buttons, selected states, key panels, the active nav item." }
    shadows:
      pop: { value: "0 12px 32px shadow-color @ 12%", use: "Menus, popovers, dialogs and the dragged field only. Nothing else casts a shadow." }
    fonts:
      display: { family: Instrument Serif, weights: [400], use: "Headings, hero, KPI numbers, one-at-a-time questions. Small (all-at-once) questions use the body font instead, since the serif has no 600. Always weight 400: scale, not weight, carries emphasis." }
      sans: { family: Figtree, weights: [400, 500, 600, 700], use: "All UI: body, labels, buttons, tables, inputs." }
      mono: { family: JetBrains Mono, use: "Slugs, embed snippets, webhook payloads." }
    typography:
      hero: { font: display, size_px: 96, line_height_px: 92, weight: 400, letter_spacing_em: -0.02, transform: none, use: "Front page hero headline only." }
      wordmark: { font: display, size_px: "fluid 72-192 (clamp(4.5rem, 14vw, 12rem))", line_height: 0.85, weight: 400, letter_spacing_em: -0.03, transform: none, use: "Front page footer wordmark (the app name) only. Decorative: one per page." }
      title: { font: display, size_px: 56, line_height_px: 56, weight: 400, letter_spacing_em: -0.015, transform: none, use: "Public page titles and front page sections." }
      heading: { font: display, size_px: 40, line_height_px: 44, weight: 400, letter_spacing_em: -0.01, transform: none, use: "Dashboard and builder page titles." }
      heading-sm: { font: display, size_px: 28, line_height_px: 32, weight: 400, letter_spacing_em: -0.005, transform: none, use: "Section titles inside chambers and large cards." }
      metric: { font: display, size_px: 48, line_height_px: 48, weight: 400, letter_spacing_em: -0.01, transform: none, use: "Hero KPI numbers (one or two per screen)." }
      question-xl: { font: display, size_px: 40, line_height_px: 44, weight: 400, letter_spacing_em: -0.01, transform: none, use: "One-at-a-time question text." }
      subheading: { font: sans, size_px: 18, line_height_px: 24, weight: 600, letter_spacing_em: 0, transform: none, use: "Card and panel titles." }
      body: { font: sans, size_px: 16, line_height_px: 24, weight: 400, letter_spacing_em: 0, transform: none, use: "Default UI and paragraph text." }
      body-sm: { font: sans, size_px: 14, line_height_px: 20, weight: 400, letter_spacing_em: 0, transform: none, use: "Tables, dense lists, descriptions." }
      label: { font: sans, size_px: 14, line_height_px: 20, weight: 500, letter_spacing_em: 0, transform: none, use: "Labels, buttons, tabs, nav items." }
      caption: { font: sans, size_px: 12, line_height_px: 16, weight: 400, letter_spacing_em: 0, transform: none, use: "Timestamps, helper text, chart axes." }
      overline: { font: sans, size_px: 12, line_height_px: 16, weight: 600, letter_spacing_em: 0.06, transform: uppercase, use: "Section eyebrows. Uppercase." }
      question: { font: sans, size_px: 18, line_height_px: 26, weight: 600, letter_spacing_em: 0, transform: none, use: "Question label in classic and paged layouts." }
      answer: { font: sans, size_px: 16, line_height_px: 24, weight: 400, letter_spacing_em: 0, transform: none, use: "Respondent inputs. Never below 16px." }
    spacing: { base_px: 4, scale_px: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96], card_padding: 24, section_gap_front_page: 96 }
    controls: { sm_px: 32, md_px: 40, lg_px: 48 }
    layout: { sidebar: 240, builder_palette: 256, builder_settings: 320, form_column: 640, question_column: 720, front_page_max: 1200 }
    motion: { fast: 120ms, base: 200ms, slow: 320ms, ease_out: "cubic-bezier(0.2, 0, 0, 1)" }
  style_guidelines:
    visual_direction:
      - Paper first. Every screen sits on the warm paper canvas; cards are a lighter paper with a 1px stone border.
      - Ink is the signature. Buttons, selected states and key panels take a 2px ink edge; that edge, not colour, says "interactive".
      - One dark chamber per screen at most in the app (the KPI hero on the dashboard); on the front page, alternate paper and chamber bands with 48px corners.
    hierarchy:
      - One periwinkle primary per view. Secondary actions are outlined paper buttons with the same 2px ink edge.
      - Headings in Instrument Serif 400 at size; never bold the serif.
      - Persimmon appears once per screen as a live signal (new responses, today, recording).
    components:
      - "Buttons: 40px tall (48px on respondent forms), 12px corners, 2px ink border, Figtree 500 14px."
      - "Inputs: 12px corners, 1px input outline, focus = 2px periwinkle ring with 2px offset."
      - "Cards: 20px corners, 1px border, 24px padding, no shadow."
      - "Badges: full pill; Live = pine fill with paper text; Draft = outlined ink; Closed = muted."
      - "Choice tiles: 12px corners; selected = periwinkle fill + 2px ink border + check icon."
      - "Key badge (A, B, C) and consent checkbox when selected: filled with the selected edge colour (--form-answer, else option-selected-border) and lettered in the tile surface colour (--form-surface, else option). Never primary-foreground on --form-answer: in a themed form both are ink. Use KEY_SELECTED from components/ds/tokens.ts."
      - "Spinner: Lucide loader, 16px (icon-sized inside a Button), colour from the surrounding text; decorative unless it has a label; stops turning under reduced motion."
      - "Slider: 6px progress-track rail, ink fill, 20px periwinkle thumb with the 2px ink edge; label it with aria-labelledby."
      - "Collapsible: trigger with a chevron that turns a quarter when open; content opens by height over 200ms."
    motion_and_interaction:
      tokens: { fast: "120ms: hover, press, colour changes", base: "200ms: menus, toggles, pop-ins, collapsibles", slow: "320ms: question-to-question slide, progress fill", easing: "cubic-bezier(0.2, 0, 0, 1) (ease-out) for everything" }
      source: "src/styles/motion.css, imported after styles.css by both the dashboard (index.css) and the public form (respondent.css). The respondent bundle has no tw-animate-css, so ds components use only the animations declared there."
      rules:
        - "Hover: buttons step to their hover token; rows, menu items and ghost buttons take accent; input, select, checkbox and radio outlines darken to muted-foreground."
        - "Press: buttons, toggles, tabs, checkboxes, radios and switches sink to 97% (the `press` utility); option, NPS and rating tiles sink to 98% (`press-tile`). Add `scale` to the element's transition list: Tailwind v4 scale-* sets the scale property, not transform."
        - "Selection lands with `animate-pop-in` (fade + 50% to 100% scale, 200ms): checkbox marks, radio dots, the selected tile's check icon, the selected rating star or face."
        - "Content that appears under its trigger uses `animate-fade-up` (fade + 4px rise, 200ms): error messages, the Other text input, empty states. Tab panels use `animate-fade-in`."
        - "Overlays open with fade + zoom-in-95 and slide 2 from their side (tw-animate-css, 200ms; tooltips 120ms); sheets slide from their edge; scrims fade."
        - "The Live status dot carries a slow 2s ping ring (`animate-live-ping`). It is the only looping animation besides spinners and skeletons."
        - "Reduced motion: styles.css collapses every transition and animation to 1ms; the live ping is hidden and spinners and skeletons stop."
        - "Never animate layout-shifting properties on content (width, height, margin) except the collapsible height and the progress fill."
    component_inventory:
      ui: "src/components/ui (shadcn/ui new-york, restyled to the tokens): alert, alert-dialog, avatar, badge, button, calendar, card, chart, checkbox, collapsible, command, dialog, dropdown-menu, input, label, popover, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip."
      ds: "src/components/ds (IntelForm's own, shared with the respondent bundle): ChoiceOption, ChoiceGroup, NpsScale, NpsSummaryBar, RatingScale, ProgressBar, TextField, StatusBadge, StatCard, EmptyState, FieldError."
      reference: "/design-system (development builds) renders every token, primitive and ds component in light and dark."
    do:
      - Use periwinkle only for the primary action and selection.
      - Keep body copy left-aligned and near 65 characters wide.
      - Pair every status colour with a word or icon.
    dont:
      - No box-shadow on cards or panels.
      - No gradients.
      - No bold serif headings.
      - No new accent hues for actions.
  quality_bar:
    - { id: contrast, label: "All 40 token pairings pass in light and dark (80 checks): text 4.5:1, borders and rings 3:1." }
    - { id: dark-mode-wins, label: "Dark tokens live in :root.dark, .dark after the light block." }
    - { id: token-fidelity, label: "No literal colours, fonts, radii or shadows in components." }
    - { id: shadowless, label: "Only popovers, menus, dialogs and the dragged field use shadow-pop." }
    - { id: interaction-states, label: "Every interactive control has hover, press, focus-visible and disabled states; motion uses the duration tokens and honours reduced motion." }
  contrast_report:
    - { mode: light, text: foreground, on: background, ratio: 14.74, min: 4.5, pass: true }
    - { mode: dark, text: foreground, on: background, ratio: 16.16, min: 4.5, pass: true }
    - { mode: light, text: foreground, on: card, ratio: 16.07, min: 4.5, pass: true }
    - { mode: dark, text: foreground, on: card, ratio: 14.47, min: 4.5, pass: true }
    - { mode: light, text: foreground, on: muted, ratio: 13.46, min: 4.5, pass: true }
    - { mode: dark, text: foreground, on: muted, ratio: 13.1, min: 4.5, pass: true }
    - { mode: light, text: muted-foreground, on: background, ratio: 6.36, min: 4.5, pass: true }
    - { mode: dark, text: muted-foreground, on: background, ratio: 9.96, min: 4.5, pass: true }
    - { mode: light, text: muted-foreground, on: card, ratio: 6.94, min: 4.5, pass: true }
    - { mode: dark, text: muted-foreground, on: card, ratio: 8.92, min: 4.5, pass: true }
    - { mode: light, text: muted-foreground, on: muted, ratio: 5.81, min: 4.5, pass: true }
    - { mode: dark, text: muted-foreground, on: muted, ratio: 8.07, min: 4.5, pass: true }
    - { mode: light, text: primary-foreground, on: primary, ratio: 9.79, min: 4.5, pass: true }
    - { mode: dark, text: primary-foreground, on: primary, ratio: 9.79, min: 4.5, pass: true }
    - { mode: light, text: primary-foreground, on: primary-hover, ratio: 7.66, min: 4.5, pass: true }
    - { mode: dark, text: primary-foreground, on: primary-hover, ratio: 7.66, min: 4.5, pass: true }
    - { mode: light, text: primary-border, on: background, ratio: 14.74, min: 3, pass: true }
    - { mode: dark, text: primary-border, on: background, ratio: 16.16, min: 3, pass: true }
    - { mode: light, text: primary-border, on: card, ratio: 16.07, min: 3, pass: true }
    - { mode: dark, text: primary-border, on: card, ratio: 14.47, min: 3, pass: true }
    - { mode: light, text: secondary-foreground, on: secondary, ratio: 16.07, min: 4.5, pass: true }
    - { mode: dark, text: secondary-foreground, on: secondary, ratio: 14.47, min: 4.5, pass: true }
    - { mode: light, text: link, on: background, ratio: 7.46, min: 4.5, pass: true }
    - { mode: dark, text: link, on: background, ratio: 8.4, min: 4.5, pass: true }
    - { mode: light, text: link, on: card, ratio: 8.13, min: 4.5, pass: true }
    - { mode: dark, text: link, on: card, ratio: 7.52, min: 4.5, pass: true }
    - { mode: light, text: destructive, on: card, ratio: 7.27, min: 4.5, pass: true }
    - { mode: dark, text: destructive, on: card, ratio: 6.25, min: 4.5, pass: true }
    - { mode: light, text: destructive-foreground, on: destructive, ratio: 7.46, min: 4.5, pass: true }
    - { mode: dark, text: destructive-foreground, on: destructive, ratio: 6.37, min: 4.5, pass: true }
    - { mode: light, text: border-ink, on: card, ratio: 16.07, min: 3, pass: true }
    - { mode: dark, text: border-ink, on: card, ratio: 14.47, min: 3, pass: true }
    - { mode: light, text: input, on: card, ratio: 3.45, min: 3, pass: true }
    - { mode: dark, text: input, on: card, ratio: 4.58, min: 3, pass: true }
    - { mode: light, text: input, on: field, ratio: 3.45, min: 3, pass: true }
    - { mode: dark, text: input, on: field, ratio: 5.11, min: 3, pass: true }
    - { mode: light, text: ring, on: background, ratio: 5.49, min: 3, pass: true }
    - { mode: dark, text: ring, on: background, ratio: 8.4, min: 3, pass: true }
    - { mode: light, text: ring, on: card, ratio: 5.99, min: 3, pass: true }
    - { mode: dark, text: ring, on: card, ratio: 7.52, min: 3, pass: true }
    - { mode: light, text: chamber-foreground, on: chamber, ratio: 14.74, min: 4.5, pass: true }
    - { mode: dark, text: chamber-foreground, on: chamber, ratio: 17.35, min: 4.5, pass: true }
    - { mode: light, text: chamber-muted, on: chamber, ratio: 9.08, min: 4.5, pass: true }
    - { mode: dark, text: chamber-muted, on: chamber, ratio: 10.69, min: 4.5, pass: true }
    - { mode: light, text: highlight-foreground, on: highlight, ratio: 4.88, min: 4.5, pass: true }
    - { mode: dark, text: highlight-foreground, on: highlight, ratio: 4.88, min: 4.5, pass: true }
    - { mode: light, text: pine-foreground, on: pine, ratio: 6.76, min: 4.5, pass: true }
    - { mode: dark, text: pine-foreground, on: pine, ratio: 9.38, min: 4.5, pass: true }
    - { mode: light, text: pine, on: card, ratio: 7.38, min: 3, pass: true }
    - { mode: dark, text: pine, on: card, ratio: 9.2, min: 3, pass: true }
    - { mode: light, text: success-subtle-foreground, on: success-subtle, ratio: 7.08, min: 4.5, pass: true }
    - { mode: dark, text: success-subtle-foreground, on: success-subtle, ratio: 10.99, min: 4.5, pass: true }
    - { mode: light, text: warning-subtle-foreground, on: warning-subtle, ratio: 5.24, min: 4.5, pass: true }
    - { mode: dark, text: warning-subtle-foreground, on: warning-subtle, ratio: 9.72, min: 4.5, pass: true }
    - { mode: light, text: info-subtle-foreground, on: info-subtle, ratio: 10.34, min: 4.5, pass: true }
    - { mode: dark, text: info-subtle-foreground, on: info-subtle, ratio: 7.02, min: 4.5, pass: true }
    - { mode: light, text: danger-subtle-foreground, on: danger-subtle, ratio: 6.93, min: 4.5, pass: true }
    - { mode: dark, text: danger-subtle-foreground, on: danger-subtle, ratio: 9.15, min: 4.5, pass: true }
    - { mode: light, text: field-placeholder, on: field, ratio: 4.96, min: 4.5, pass: true }
    - { mode: dark, text: field-placeholder, on: field, ratio: 7.18, min: 4.5, pass: true }
    - { mode: light, text: option-border, on: option, ratio: 3.45, min: 3, pass: true }
    - { mode: dark, text: option-border, on: option, ratio: 4.58, min: 3, pass: true }
    - { mode: light, text: option-selected-foreground, on: option-selected, ratio: 9.79, min: 4.5, pass: true }
    - { mode: dark, text: option-selected-foreground, on: option-selected, ratio: 11.27, min: 4.5, pass: true }
    - { mode: light, text: option-selected-border, on: option, ratio: 16.07, min: 3, pass: true }
    - { mode: dark, text: option-selected-border, on: option, ratio: 7.52, min: 3, pass: true }
    - { mode: light, text: progress, on: progress-track, ratio: 11.57, min: 3, pass: true }
    - { mode: dark, text: progress, on: progress-track, ratio: 5.85, min: 3, pass: true }
    - { mode: light, text: sidebar-foreground, on: sidebar, ratio: 9.1, min: 4.5, pass: true }
    - { mode: dark, text: sidebar-foreground, on: sidebar, ratio: 11.36, min: 4.5, pass: true }
    - { mode: light, text: sidebar-accent-foreground, on: sidebar-accent, ratio: 9.79, min: 4.5, pass: true }
    - { mode: dark, text: sidebar-accent-foreground, on: sidebar-accent, ratio: 11.27, min: 4.5, pass: true }
    - { mode: light, text: accent-foreground, on: accent, ratio: 13.46, min: 4.5, pass: true }
    - { mode: dark, text: accent-foreground, on: accent, ratio: 13.1, min: 4.5, pass: true }
    - { mode: light, text: chart-1, on: card, ratio: 5.99, min: 3, pass: true }
    - { mode: dark, text: chart-1, on: card, ratio: 7.52, min: 3, pass: true }
    - { mode: light, text: chart-2, on: card, ratio: 5.15, min: 3, pass: true }
    - { mode: dark, text: chart-2, on: card, ratio: 6.51, min: 3, pass: true }
    - { mode: light, text: chart-3, on: card, ratio: 3.29, min: 3, pass: true }
    - { mode: dark, text: chart-3, on: card, ratio: 4.79, min: 3, pass: true }
craft: >
  # Craft (universal core + conditional craft)


  How to apply this design system well. These rules contain no brand look of their own — all

  per-system character comes from the tokens and taste notes above; this section only governs

  how they are composed. **Precedence:** the design system above is the authority on how things

  look — where its own notes conflict with a rule here, the design system wins. And the user's

  request is the authority on what the screen IS — notes above that describe the source

  product's screens (workspaces, dashboards, panels) are its aesthetic heritage, not an

  instruction to build that kind of screen.


  ## Universal — applies to every screen (screen-agnostic craft)


  - **Surface definition.** Every container is visually separable from what it sits on — at least
  one
    honest edge cue: a hairline border, a ≥4% tonal step from its parent, or a real shadow. Never a card
    whose fill matches its section with no border; never nested surfaces that dissolve together.
  - **Accent discipline.** The brand/primary color is a scalpel, not paint: spend it on the primary
    action, the active/selected/focused state, and at most **one** brand or data highlight per screen.
    Everything else rides neutral background / card / muted / border tokens. A screen flooded with brand
    color reads unfinished, not bold.
  - **Restraint ledger.** Beauty is also what you don't do: at most one glow and two gradient
  directions
    screen-wide; decoration only where content doesn't reach; no ornament between a heading and its own
    action. Every decorative element must answer "what does this make clearer or more felt?" — if the
    answer is "nothing," remove it.
  - **Type with intent.** The measured faces/scale are fixed; character comes from *usage*, and the
  move
    must fit the surface — a marketing page earns a dramatic display move; a working screen earns a
    crisp, tight, legible hierarchy at UI scale (display-hero type on a dense tool is a smell). Chrome
    and wayfinding are never display type; data numerals are tabular (mono or sans), never the
    decorative face. Headings stay roman — italics live as emphasis inside running text, not as
    display styling (unless the system's own type says otherwise).
  - **Anti-default.** If the screen could pass for a generic template with the colors swapped, it is
  not
    done. Make the brand unmistakable through the accent's *use*, the type, the radius + density, and
    **one** signature detail — never by importing another surface's clichés.
  - **Honest content.** Never invent proof — no made-up adoption counts, growth percentages,
    testimonials, client logos, or awards. Use the user's real content, a neutral placeholder, or
    leave the element out and let the layout carry it. Never hand-draw fake browser bars, phone
    frames, or editor chrome around content — show the content itself, or nothing.
  - **Interaction integrity.** Buttons, links, tabs, and nav labels never wrap to two lines; display
    headlines wrap cleanly, never clipping mid-word; nothing overflows horizontally at any width;
    keyboard focus gets an instant, clearly visible ring.
  - **Token fidelity.** Every design value comes from a token: colors, radii, shadows, and fonts
  from
    the system's variables — never a literal hex, a hand-picked shadow, or a substitute font. For a
    translucent or composited value (a scrim, a glow, a hairline over a fill), derive it from a token
    (an opacity modifier or color-mix), never a literal rgba. If the system specifies square corners and
    a hard shadow, the screen shows square corners and that hard shadow — not a rounded, soft substitute.

  ## Conditional — apply ONLY the layer that matches the screen the user asked for


  **First name the screen honestly from the user's prompt.** Then apply the matching guidance. Do
  not

  cross layers, and **do not add elements from a layer the screen doesn't call for** — a screen that
  is

  not a data view must not sprout KPI tiles, charts, filter bars, or data tables to satisfy a
  template.


  - **If it's a data / dashboard / admin / table view:** density done well (comfortable rows, tight
    control clusters, one spacing rhythm); a populated working state (real rows/cards, not empty feature
    boxes); tables with aligned tabular numerals, status as badges, row hover, one visible selected row,
    and control states that agree with the data shown. KPI tiles, *if the screen has them*, are
    value + label + delta. **At most one** chart, of a real metric for this domain, token-colored and
    axis-labeled — never a decorative sine wave or filler sparkline. Exactly one unambiguous primary
    action.

  - **If it's a focused task / tool / player / capture / monitor / form / wizard (not a data
  view):**
    the screen's real job dominates the frame; chrome recedes. Honor the screen's own nature — a player
    looks like a player, a monitor like a monitor, a form like a form — with the design system's color,
    type, radius, and depth applied to *those* elements. **No dashboard furniture**: no KPI tiles, no
    charts, no data tables, no filter chrome unless the task itself is about that data. Real-time or
    safety-critical readouts get calm, unambiguous, high-legibility treatment over decoration.

  - **If it's a marketing / landing surface:** editorial art direction belongs here — section rhythm
    (modulate surface temperature, density, and scale; one oversized moment; at least one full-bleed
    band) and considered visual treatments. Never put this on a working app screen.

  - **Mobile:** follow the platform's native idioms for the screen's type (e.g. an app screen:
  compact
    top bar, one focused column, a bottom tab bar, ≥44px targets, safe areas) — the same conditional
    rules above still decide what content belongs.

  ## Imagery (universal)


  - **Imagery is content, not decoration** on working screens: images are data (covers, products,
    avatars, places) in purposeful containers, one consistent treatment across siblings — never a lone
    photo floating in a box, never marketing's decorative fades on a work screen. When a moment needs
    atmosphere, build it from the token system (tinted panels, token gradients, geometry).

/**
 * System labels: every piece of fixed respondent-facing text. Editable per form
 * (definition.labels, PRD "Form settings → System labels") so non-English forms read naturally.
 * Placeholders: {n}, {total}.
 *
 * Validation errors from the field-type registry are label keys (see `errorMessage`), so a
 * translated form also gets translated errors on both the client and the server.
 */
export const SYSTEM_LABELS = {
  // Navigation
  start: 'Start',
  next: 'Next',
  back: 'Back',
  submit: 'Submit',
  submitting: 'Submitting…',
  ok: 'OK',
  pressEnter: 'press Enter ↵',
  shiftEnter: 'Shift + Enter for a new line',
  previousQuestion: 'Previous question',
  nextQuestion: 'Next question',
  step: 'Step {n} of {total}',
  question: 'Question {n} of {total}',
  minutes: 'Takes about {n} minutes',
  minutesOne: 'Takes about 1 minute',
  autoAdvanceHint: 'Choosing an answer moves to the next question',
  questionNavigation: 'Question navigation',
  untitledQuestion: 'Untitled question',

  // Inputs
  typeAnswer: 'Type your answer here',
  other: 'Other',
  otherPlaceholder: 'Type your answer',
  choose: 'Choose an option',
  search: 'Search',
  noResults: 'No matches',
  yes: 'Yes',
  no: 'No',
  firstName: 'First name',
  lastName: 'Last name',
  street: 'Street address',
  line2: 'Address line 2',
  city: 'City',
  state: 'State / Province',
  postal: 'Postal code',
  country: 'Country',
  npsLow: 'Not likely',
  npsHigh: 'Extremely likely',
  signHere: 'Sign here',
  signed: 'Signature added',
  typeToSign: 'Type your name to sign',
  typeInstead: 'Type instead',
  drawInstead: 'Draw instead',
  clear: 'Clear',
  hour: 'Hour',
  minute: 'Minute',
  amPm: 'AM or PM',
  openCalendar: 'Open calendar',
  calendar: 'Calendar',

  // Errors (the text says how to fix it)
  required: 'This question is required',
  invalid: 'Check this answer',
  invalidEmail: 'Enter an email address like name@example.com',
  freeEmail: 'Use your work email address',
  invalidUrl: 'Enter a link like https://example.com',
  invalidPhone: 'Enter a phone number with its country code',
  invalidNumber: 'Enter a number',
  wholeNumber: 'Enter a whole number',
  numberMin: 'Enter a number of at least {n}',
  numberMax: 'Enter a number of at most {n}',
  invalidDate: 'Enter a real date',
  dateMin: 'Choose a date on or after {n}',
  dateMax: 'Choose a date on or before {n}',
  datePast: 'Choose a date that is not in the past',
  dateFuture: 'Choose a date that is not in the future',
  invalidTime: 'Enter a time like 09:30',
  timeStep: 'Choose a time in steps of {n} minutes',
  minChars: 'Enter at least {n} characters',
  maxChars: 'Enter no more than {n} characters',
  invalidChoice: 'Choose one of the options',
  otherRequired: 'Fill in your "Other" answer',
  chooseAtLeast: 'Choose at least {n}',
  chooseAtMost: 'Choose at most {n}',
  invalidCountry: 'Choose a country from the list',
  invalidRating: 'Choose a rating',
  invalidSignature: 'Sign again in the box',
  consentRequired: 'Tick the box to continue',
  hiddenField: 'This question is not shown, so it cannot be answered',
  errorSummary: 'Fix these problems to continue',
  submitError: 'Your response could not be sent. Check your connection and try again.',
  humanCheckFailed: 'We couldn’t check that you’re human. Try submitting again.',
  /** Prefix for document.title while the page shows an error, e.g. "Error: Question 2 of 5 – Title". */
  errorTitle: 'Error',

  // Form states
  /** End screen title when the form's own is blank. */
  thanks: 'Thanks! Your response has been recorded.',
  formUpdated: 'This form was updated. Reload to see the latest version.',
  reload: 'Reload',
  formMissingTitle: 'This form doesn’t exist',
  formMissing: 'Check the link you were given. The form may have been moved or deleted.',
  loadErrorTitle: 'This form couldn’t load',
  loadError: 'Check your connection and reload the page.',
  closed: 'This form is no longer accepting responses.',
  passwordPrompt: 'This form is protected. Enter the password to continue.',
  password: 'Password',
  unlock: 'Continue',
  wrongPassword: 'That password is not right. Try again.',
  alreadyResponded: 'You have already responded to this form.',
  /** Submit from a page left open for over a day. The reload keeps the answers. */
  pageExpired: 'This page has been open too long to submit. Reload to continue; your answers are kept.',
  /** One response per email: the email question was left blank. */
  emailNeeded: 'Enter your email address. This form accepts one response per address.',
  /** One response per email, but the form has no email question to check. */
  cannotAccept: 'This form can’t accept responses right now. Let the person who sent it know.',
}

export type LabelKey = keyof typeof SYSTEM_LABELS
export type Labels = Record<LabelKey, string>

export const LABEL_KEYS = Object.keys(SYSTEM_LABELS) as LabelKey[]

/** Defaults merged with a form's overrides. Unknown keys and blank overrides are ignored. */
export function resolveLabels(overrides?: Record<string, string> | null): Labels {
  const out: Labels = { ...SYSTEM_LABELS }
  if (!overrides) return out
  for (const key of LABEL_KEYS) {
    const v = overrides[key]
    if (typeof v === 'string' && v.trim() !== '') out[key] = v
  }
  return out
}

/** Fill {n}, {total} and any other {name} placeholder. */
export function formatLabel(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-z]+)\}/gi, (m, name: string) =>
    name in params ? String(params[name]) : m,
  )
}

/**
 * Field-type validators report errors as "key" or "key:param" (e.g. "minChars:5").
 * Turn that into the respondent-facing text.
 */
export function errorMessage(code: string, labels: Labels = SYSTEM_LABELS): string {
  const i = code.indexOf(':')
  const key = (i === -1 ? code : code.slice(0, i)) as LabelKey
  const param = i === -1 ? undefined : code.slice(i + 1)
  const template = Object.hasOwn(labels, key) ? labels[key] : labels.invalid
  return param === undefined ? template : formatLabel(template, { n: param })
}

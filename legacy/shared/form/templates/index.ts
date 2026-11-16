import type { z } from 'zod'
import { formDefinition, type FormDefinition } from '../definition'
import type { FormSettings } from '../settings'

/**
 * The 10 built-in templates (PRD "Templates"), in the same JSON format as user forms.
 * server/db/seed.ts upserts them by slug (always prefixed `builtin-`). Field and option ids are
 * fixed here so the seed hash is stable; a form made from a template gets fresh ids
 * (remapTemplateIds).
 *
 * "Owner notification on" is `notifyOnResponse: true` with no recipients: an empty list means
 * the Owner (the seed can't know anyone's user id).
 */

export interface BuiltinTemplate {
  slug: string
  name: string
  category: string
  description: string
  sortOrder: number
  definition: FormDefinition
  /** Only what differs from defaultFormSettings(). */
  settings: Partial<FormSettings>
}

type DefinitionInput = z.input<typeof formDefinition>
type FieldInput = DefinitionInput['fields'][number]

const opts = (prefix: string, labels: string[]) => labels.map((label, i) => ({ id: `o_${prefix}${i + 1}`, label }))

const consent = (id: string, text = 'I agree to the privacy policy and to being contacted about this request'): FieldInput => ({
  id,
  type: 'consent',
  label: 'Consent',
  hideLabel: true,
  required: true,
  props: { text },
})

const END = { title: 'Thanks!', message: 'Your response has been recorded.', redirectUrl: null }
const NO_START = { enabled: false, title: '', button: 'Start' }

const RAW: (Omit<BuiltinTemplate, 'definition'> & { definition: DefinitionInput })[] = [
  {
    slug: 'builtin-lead-capture',
    name: 'Lead capture',
    category: 'Marketing',
    description: 'Collect contact details and what a prospect is interested in, one question at a time.',
    sortOrder: 1,
    settings: { onePerEmail: true, onePerEmailFieldId: 'f_lcemail' },
    definition: {
      layout: 'one_at_a_time',
      startScreen: NO_START,
      fields: [
        { id: 'f_lcname', type: 'name', label: 'What’s your name?', required: true, props: { split: true } },
        { id: 'f_lcemail', type: 'email', label: 'Thanks, {f_lcname.first|there}. What’s your email?', required: true, placeholder: 'name@company.com' },
        { id: 'f_lcphone', type: 'phone', label: 'And a phone number?', description: 'Optional. Only if you’d like a call.' },
        { id: 'f_lccomp', type: 'short_text', label: 'Which company are you with?', placeholder: 'Company name' },
        {
          id: 'f_lcint',
          type: 'single_choice',
          label: 'What are you most interested in?',
          required: true,
          props: { options: opts('lci', ['A product demo', 'Pricing', 'A partnership', 'Something else']) },
        },
        consent('f_lccons'),
      ],
      endScreen: { title: 'Thanks, {f_lcname.first|there}!', message: 'We’ll be in touch soon.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-contact-support',
    name: 'Contact / support',
    category: 'Support',
    description: 'A short support form. You get an email for each new message.',
    sortOrder: 2,
    settings: { notifyOnResponse: true },
    definition: {
      layout: 'all_at_once',
      startScreen: NO_START,
      fields: [
        { id: 'f_csname', type: 'name', label: 'Name', required: true },
        { id: 'f_csemail', type: 'email', label: 'Email', required: true, description: 'We reply to this address.' },
        {
          id: 'f_cstopic',
          type: 'dropdown',
          label: 'Topic',
          required: true,
          props: { options: opts('cst', ['General question', 'Account or billing', 'Technical problem', 'Feedback', 'Other']), searchable: false },
        },
        { id: 'f_csmsg', type: 'long_text', label: 'Message', required: true, placeholder: 'How can we help?', props: { rows: 6 } },
      ],
      endScreen: { title: 'Message sent', message: 'Thanks for getting in touch. We usually reply within one working day.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-application',
    name: 'Application',
    category: 'HR',
    description: 'A job or programme application in three sections: about you, experience, availability.',
    sortOrder: 3,
    settings: { onePerEmail: true, onePerEmailFieldId: 'f_apemail' },
    definition: {
      layout: 'section_by_section',
      startScreen: NO_START,
      fields: [
        { id: 'f_apsec1', type: 'section_break', label: 'About you', description: 'How we can reach you.' },
        { id: 'f_apname', type: 'name', label: 'Full name', required: true, props: { split: true } },
        { id: 'f_apemail', type: 'email', label: 'Email', required: true },
        { id: 'f_apphone', type: 'phone', label: 'Phone', required: true },
        { id: 'f_apaddr', type: 'address', label: 'Address', props: { lines: { street: true, line2: true, city: true, state: true, postal: true, country: true } } },
        { id: 'f_apsec2', type: 'section_break', label: 'Your experience', description: 'Tell us about your work so far.' },
        { id: 'f_apport', type: 'url', label: 'Portfolio or LinkedIn', placeholder: 'https://' },
        { id: 'f_apyears', type: 'number', label: 'Years of relevant experience', required: true, props: { min: 0, max: 60, allowDecimals: false } },
        { id: 'f_apwhy', type: 'long_text', label: 'Why are you a good fit?', required: true, props: { rows: 6, maxLength: 3000 } },
        { id: 'f_apsec3', type: 'section_break', label: 'Availability' },
        { id: 'f_apstart', type: 'date', label: 'Earliest start date', required: true, props: { disablePast: true } },
        consent('f_apcons', 'I confirm the information above is accurate and agree to it being stored for this application'),
      ],
      endScreen: { title: 'Application received', message: 'Thanks, {f_apname.first|there}. We review every application and will reply by email.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-survey',
    name: 'Survey',
    category: 'Research',
    description: 'A short customer survey: three ratings, a few choices and an open question.',
    sortOrder: 4,
    settings: {},
    definition: {
      layout: 'one_at_a_time',
      startScreen: {
        enabled: true,
        title: 'Help us improve',
        description: 'Seven quick questions about your experience with us. Your answers are anonymous.',
        button: 'Start',
        minutes: 2,
      },
      fields: [
        { id: 'f_svqual', type: 'rating', label: 'How would you rate the quality of our product?', required: true, props: { style: 'stars', scale: 5 } },
        { id: 'f_svease', type: 'rating', label: 'How easy is it to use?', required: true, props: { style: 'numbers', scale: 5, leftLabel: 'Very hard', rightLabel: 'Very easy' } },
        { id: 'f_svsupp', type: 'rating', label: 'How happy are you with our support?', props: { style: 'emoji', scale: 5 } },
        {
          id: 'f_svfreq',
          type: 'single_choice',
          label: 'How often do you use it?',
          required: true,
          props: { options: opts('svf', ['Every day', 'A few times a week', 'A few times a month', 'Rarely']) },
        },
        {
          id: 'f_svlong',
          type: 'single_choice',
          label: 'How long have you been a customer?',
          props: { options: opts('svl', ['Less than 3 months', '3 to 12 months', '1 to 3 years', 'More than 3 years']) },
        },
        {
          id: 'f_svfeat',
          type: 'multiple_choice',
          label: 'Which features do you use?',
          description: 'Choose all that apply.',
          props: { options: opts('svx', ['Reports', 'Integrations', 'Mobile app', 'Team sharing', 'Automations']), other: true },
        },
        { id: 'f_svmore', type: 'long_text', label: 'Anything else you’d like to tell us?' },
      ],
      endScreen: { title: 'Thank you!', message: 'Your answers help us decide what to build next.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-nps',
    name: 'NPS',
    category: 'Feedback',
    description: 'Net Promoter Score with a follow-up question that changes with the score.',
    sortOrder: 5,
    settings: {},
    definition: {
      layout: 'one_at_a_time',
      startScreen: NO_START,
      fields: [
        { id: 'f_npsscore', type: 'nps', label: 'How likely are you to recommend us to a friend or colleague?', required: true },
        {
          id: 'f_npslow',
          type: 'long_text',
          label: 'What’s the main reason for your score? What could we do better?',
          logic: { action: 'show', match: 'all', conditions: [{ field: 'f_npsscore', op: 'lte', value: 6 }] },
        },
        {
          id: 'f_npshigh',
          type: 'long_text',
          label: 'What’s the main reason for your score? What do you like most?',
          logic: { action: 'show', match: 'all', conditions: [{ field: 'f_npsscore', op: 'gte', value: 7 }] },
        },
        { id: 'f_npsemail', type: 'email', label: 'Your email', description: 'Optional. Leave it if you’re happy for us to follow up.' },
      ],
      endScreen: { title: 'Thanks for your feedback', message: 'We read every response.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-event-registration',
    name: 'Event registration',
    category: 'Events',
    description: 'Sign people up for an event and a session, with dietary and access needs.',
    sortOrder: 6,
    settings: { onePerEmail: true, onePerEmailFieldId: 'f_evemail' },
    definition: {
      layout: 'all_at_once',
      startScreen: NO_START,
      fields: [
        { id: 'f_evname', type: 'name', label: 'Name', required: true, props: { split: true } },
        { id: 'f_evemail', type: 'email', label: 'Email', required: true, description: 'We send your confirmation here.' },
        { id: 'f_evphone', type: 'phone', label: 'Phone' },
        {
          id: 'f_evsess',
          type: 'single_choice',
          label: 'Which session will you attend?',
          required: true,
          props: { options: opts('evs', ['Morning (9:00 to 12:00)', 'Afternoon (13:00 to 16:00)', 'Both']) },
        },
        { id: 'f_evneeds', type: 'long_text', label: 'Dietary or access needs', description: 'Optional. Tell us anything that helps you take part.', props: { rows: 3 } },
        consent('f_evcons', 'I agree to my details being used to manage this event'),
      ],
      endScreen: { title: 'You’re registered, {f_evname.first|there}!', message: 'See you there.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-appointment-request',
    name: 'Appointment request',
    category: 'Services',
    description: 'Let clients ask for a service on a date and time that suits them.',
    sortOrder: 7,
    settings: { responseCap: null },
    definition: {
      layout: 'section_by_section',
      startScreen: NO_START,
      fields: [
        { id: 'f_amsec1', type: 'section_break', label: 'Your details' },
        { id: 'f_amname', type: 'name', label: 'Name', required: true },
        { id: 'f_amemail', type: 'email', label: 'Email', required: true },
        { id: 'f_amphone', type: 'phone', label: 'Phone', required: true },
        { id: 'f_amsec2', type: 'section_break', label: 'Your appointment', description: 'We’ll confirm the exact time by email.' },
        {
          id: 'f_amserv',
          type: 'dropdown',
          label: 'Service',
          required: true,
          props: { options: opts('ams', ['Consultation', 'Follow-up', 'Assessment', 'Other']), searchable: false },
        },
        { id: 'f_amdate', type: 'date', label: 'Preferred date', required: true, props: { disablePast: true } },
        { id: 'f_amtime', type: 'time', label: 'Preferred time', required: true, props: { step: 30 } },
        { id: 'f_amnotes', type: 'long_text', label: 'Notes', description: 'Optional. Anything we should know beforehand.', props: { rows: 3 } },
        consent('f_amcons'),
      ],
      endScreen: { title: 'Request sent', message: 'We’ll confirm your appointment by email.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-waitlist',
    name: 'Waitlist',
    category: 'Marketing',
    description: 'Collect sign-ups for a launch, and learn where people heard about you.',
    sortOrder: 8,
    settings: { onePerEmail: true, onePerEmailFieldId: 'f_wlemail' },
    definition: {
      layout: 'one_at_a_time',
      startScreen: NO_START,
      fields: [
        { id: 'f_wlemail', type: 'email', label: 'What’s your email?', required: true, placeholder: 'name@example.com' },
        { id: 'f_wlname', type: 'name', label: 'And your name?' },
        {
          id: 'f_wlsrc',
          type: 'dropdown',
          label: 'How did you hear about us?',
          props: { options: opts('wls', ['Search engine', 'Social media', 'A friend or colleague', 'Newsletter or blog', 'Event', 'Other']), searchable: false },
        },
      ],
      endScreen: { title: 'You’re on the list', message: 'We’ll email you as soon as it’s your turn.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-b2b-enquiry',
    name: 'B2B enquiry',
    category: 'Sales',
    description: 'A sales enquiry form that only accepts work email addresses.',
    sortOrder: 9,
    settings: { notifyOnResponse: true },
    definition: {
      layout: 'all_at_once',
      startScreen: NO_START,
      fields: [
        { id: 'f_bbname', type: 'name', label: 'Name', required: true },
        { id: 'f_bbemail', type: 'email', label: 'Work email', required: true, props: { blockFreeDomains: true } },
        { id: 'f_bbcomp', type: 'short_text', label: 'Company', required: true },
        {
          id: 'f_bbsize',
          type: 'dropdown',
          label: 'Company size',
          required: true,
          props: { options: opts('bbs', ['1 to 10', '11 to 50', '51 to 200', '201 to 1,000', 'More than 1,000']), searchable: false },
        },
        { id: 'f_bbctry', type: 'country', label: 'Country', required: true },
        {
          id: 'f_bbbudg',
          type: 'dropdown',
          label: 'Budget',
          props: { options: opts('bbb', ['Under $5,000', '$5,000 to $20,000', '$20,000 to $100,000', 'Over $100,000', 'Not sure yet']), searchable: false },
        },
        { id: 'f_bbmsg', type: 'long_text', label: 'How can we help?', required: true, props: { rows: 5 } },
      ],
      endScreen: { title: 'Thanks for your enquiry', message: 'Someone from our team will reply within two working days.', redirectUrl: null },
    },
  },
  {
    slug: 'builtin-post-purchase-feedback',
    name: 'Post-purchase feedback',
    category: 'Feedback',
    description: 'Ask customers how their purchase went, right after they buy.',
    sortOrder: 10,
    settings: {},
    definition: {
      layout: 'one_at_a_time',
      startScreen: {
        enabled: true,
        title: 'How did we do?',
        description: 'Four quick questions about your recent order.',
        button: 'Start',
        minutes: 1,
      },
      fields: [
        { id: 'f_ppstar', type: 'rating', label: 'How would you rate your purchase?', required: true, props: { style: 'stars', scale: 5 } },
        {
          id: 'f_pplike',
          type: 'multiple_choice',
          label: 'What did you like?',
          description: 'Choose all that apply.',
          props: { options: opts('ppl', ['Product quality', 'Price', 'Delivery speed', 'Packaging', 'Customer service']), other: true },
        },
        { id: 'f_ppagain', type: 'yes_no', label: 'Would you buy from us again?', required: true },
        { id: 'f_ppnote', type: 'long_text', label: 'Any other comments?' },
      ],
      endScreen: { ...END, title: 'Thank you!', message: 'Your feedback helps us get better.' },
    },
  },
]

/** Every built-in template, parsed through the form definition schema (defaults filled in). */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = RAW.map((t) => ({ ...t, definition: formDefinition.parse(t.definition) }))

/** Raw definitions, before parsing (for tests). */
export const BUILTIN_TEMPLATE_INPUTS = RAW

export { remapTemplateIds } from './remap'

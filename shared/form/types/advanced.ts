import * as z from 'zod/mini'
import { safeUrlMini } from '../safe-url-core'
import { BOOL_OPS, PRESENCE_OPS, base, defineType, isRecord, str, type AnswerContext } from './common'

// ------------------------------------------------------------------ Signature: { url }

/**
 * Submit format: the browser sends `{ url: "data:image/png;base64,…" }`. The server checks it
 * (isSignatureDataUrl, then the PNG magic bytes), uploads the PNG (storeBuffer) and stores
 * `{ url: "https://cdn…/sig.png" }`. Only the data URL validates here: a client-supplied URL
 * would let a respondent point a stored answer (and the owner's emails) at any image.
 */
export interface SignatureAnswer {
  url: string
}

/** ~300 KB of base64: a 600×200 PNG of a signature is far below this. */
export const SIGNATURE_DATA_URL_MAX = 400_000
const DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

export function isSignatureDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= SIGNATURE_DATA_URL_MAX && DATA_URL_RE.test(v)
}

/** Decode a validated signature data URL to bytes (server side, before upload). */
export function signatureBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function signatureUrl(v: unknown): string {
  return isRecord(v) && typeof v.url === 'string' ? v.url : ''
}

const signatureProps = z.object({})

export const signature = defineType({
  ...base('signature'),
  props: signatureProps,
  defaultProps: () => ({}),
  answer: () =>
    z.object(
      {
        url: z.string({ error: 'invalidSignature' }).check(z.refine((u: string) => isSignatureDataUrl(u), 'invalidSignature')),
      },
      { error: 'invalidSignature' },
    ),
  isEmpty: (v) => signatureUrl(v) === '',
  operators: PRESENCE_OPS,
  evaluate: (op, a) => (op === 'is_empty' ? signatureUrl(a) === '' : op === 'is_not_empty' ? signatureUrl(a) !== '' : false),
  pipeParts: () => [],
  pipe: () => '',
  csvColumns: () => [''],
  // Data URLs never reach a stored response; guard anyway so a CSV never carries one.
  csv: (v) => [signatureUrl(v).startsWith('data:') ? '' : signatureUrl(v)],
})

// ------------------------------------------------------------------ Consent: { accepted: true, at, text, version? }

export interface ConsentAnswer {
  accepted: true
  /** ISO timestamp of the tick. */
  at: string
  /** The checkbox text shown, copied from the field at submit. */
  text: string
  /** Form version the respondent saw. */
  version?: number
}

const consentProps = z.object({
  text: z._default(z.string().check(z.maxLength(1000)), 'I agree to the terms and privacy policy'),
  link: z._default(
    z.nullable(z.object({ label: z._default(z.string().check(z.maxLength(100)), 'Privacy policy'), url: safeUrlMini })),
    null,
  ),
})

function accepted(v: unknown): boolean {
  return isRecord(v) && v.accepted === true
}

export const consent = defineType({
  ...base('consent'),
  props: consentProps,
  defaultProps: () => consentProps.parse({}),
  /**
   * The browser sends `{ accepted: true, at: new Date().toISOString() }`. The output always
   * carries the field's current checkbox text; `ctx.now` and `ctx.formVersion` (server) override
   * the client's timestamp and version.
   */
  answer: (field, ctx?: AnswerContext) =>
    z.pipe(
      z.object(
        {
          accepted: z.literal(true, { error: 'consentRequired' }),
          at: z.optional(z.iso.datetime({ offset: true, error: 'invalid' })),
          version: z.optional(z.number().check(z.int(), z.gte(1))),
        },
        { error: 'consentRequired' },
      ),
      z.transform(
        (v: { accepted: true; at?: string; version?: number }): ConsentAnswer => ({
          accepted: true,
          at: ctx?.now?.toISOString() ?? v.at ?? new Date().toISOString(),
          text: field.props.text,
          ...((ctx?.formVersion ?? v.version) !== undefined && { version: ctx?.formVersion ?? v.version }),
        }),
      ),
    ),
  isEmpty: (v) => !accepted(v),
  operators: BOOL_OPS,
  /** Unticked counts as "no" (consent is the one type where empty is a meaningful answer). */
  evaluate: (op, a) => (op === 'is_yes' ? accepted(a) : op === 'is_no' ? !accepted(a) : false),
  pipeParts: () => [],
  pipe: (v) => (accepted(v) ? 'Yes' : ''),
  csvColumns: () => [''],
  csv: (v) => [accepted(v) ? `Accepted ${isRecord(v) ? str(v.at) : ''}`.trim() : ''],
  migrateProps: (from, old) => (from === 'consent' ? z.partial(consentProps).safeParse(old).data ?? {} : {}),
})

// ------------------------------------------------------------------ Section break: stores nothing

/**
 * The page title and description are the field's own `label` and `description`, so piping,
 * hide label and the type-change rules work the same as for every other field.
 */
const sectionBreakProps = z.object({})

export const section_break = defineType({
  ...base('section_break'),
  props: sectionBreakProps,
  defaultProps: () => ({}),
  answer: () => z.never(),
  isEmpty: () => true,
  operators: [],
  evaluate: () => false,
  pipeParts: () => [],
  pipe: () => '',
  csvColumns: () => [],
  csv: () => [],
})

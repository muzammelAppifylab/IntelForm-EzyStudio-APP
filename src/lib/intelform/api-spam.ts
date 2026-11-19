import { z } from 'zod'

/** `/site-api/blocked-visitors`: the site's block list (App settings → Spam protection). */
export const BLOCKED_VISITORS_API = '/site-api/blocked-visitors'

export const BLOCK_LENGTHS = ['hour', 'day', 'week', 'month'] as const
export type BlockLength = (typeof BLOCK_LENGTHS)[number]

export interface BlockedVisitor {
  /** Opaque id (the keyed hash of the address block): what DELETE takes. Never the address. */
  id: string
  /**
   * The address block (`203.0.113.7`, `2001:db8:1:2::/64`) for people who may change the app
   * settings; masked (`203.0.•.•`) for everyone else; null when it isn't known.
   */
  address: string | null
  /** `limits`: blocked automatically; `manual`: by an admin. */
  reason: 'limits' | 'manual'
  /** Refused submits that led to it. */
  hits: number
  /** Times blocked in the last 30 days (1 hour, then 24 hours, then 7 days). */
  step: number
  form: { id: string; title: string } | null
  expiresAt: string
  updatedAt: string
}

export interface BlockedVisitorsPage {
  blocks: BlockedVisitor[]
  /** Pass back as `?before=` for the next page; null on the last one. */
  next: string | null
  /** The viewer may add and remove blocks (and sees full addresses). */
  canManage: boolean
}

export const addBlockInput = z
  .object({
    address: z.string().trim().min(1, 'Enter an IP address').max(64, 'Enter an IP address like 203.0.113.7'),
    length: z.enum(BLOCK_LENGTHS, { error: 'Pick how long to block it' }),
  })
  .strict()
export type AddBlockInput = z.infer<typeof addBlockInput>

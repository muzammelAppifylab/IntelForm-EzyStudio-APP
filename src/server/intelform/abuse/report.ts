/**
 * The platform report hook: an address block this site blocked for abuse. The platform will
 * later accept these reports server to server (to spot a bot hitting many sites); until then this
 * is a no-op, called from the one place that blocks automatically (./blocks.ts `autoBlock`).
 *
 * Only the KEYED hash of the block goes (`ipKey`, never the address itself): it means nothing
 * outside this site. Never throws: a report that can't go must not change what the visitor sees.
 */
export interface AbuseReport {
  /** The keyed hash of the address block (crypto.ts `ipKeyFor`). */
  ipKey: string
  /** Why it was blocked: `limits` (kept hitting the submit limits). */
  reason: string
  /** How many refused submits led to the block. */
  count: number
}

export interface ReportContext {
  /** The current request's URL (the platform's address), when there is one. */
  requestUrl?: string
}

export async function reportAbusiveIp(_ctx: ReportContext, _report: AbuseReport): Promise<void> {
  // Nothing to send yet: the platform has no endpoint for these reports.
}

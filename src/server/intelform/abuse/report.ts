import {PLATFORM_HEADERS} from '../../../platform/api';
import {config} from '../../../platform/config';

/**
 * Tells the platform about an address this site just blocked automatically (./blocks.ts
 * `autoBlock`), so the platform's edge refuses that address's form posts on THIS site before the
 * site runs: no database query, no billed request. The platform only ever applies it to this
 * site's own addresses, never to other sites, and ignores its own and private addresses.
 *
 * Called once per NEW block (never per refused submit). Sends the network (`ipBlock`: an IPv4
 * address or an IPv6 /64), the one thing the edge can match on. Never throws: a report that
 * can't go must not change what the visitor sees. A site on the platform's newer template can use
 * `reportAbusiveIp` from `src/platform/abuse.ts` instead; this is the plain request it makes
 * (docs/agent/security.md, "Blocking an abusive visitor").
 */
export interface AbuseReport {
  /** The network to block: an IPv4 address or an IPv6 /64 (crypto.ts `ipBlockOf`). */
  ipBlock: string;
  /** Why it was blocked: `limits` (kept hitting the submit limits). */
  reason: 'limits';
  /** How many refused submits led to the block. */
  count: number;
}

export type ReportResult = {ok: true} | {ok: false; reason: string};

const PATH = '/api/site/v1/abuse/ip-blocks';
const TIMEOUT_MS = 4000;

export async function reportAbusiveIp(report: AbuseReport): Promise<ReportResult> {
  const siteKey = config.siteKey;
  const siteUrl = config.siteUrl;
  if (!siteKey || !siteUrl) return {ok: false, reason: 'no_site_key'};
  try {
    const res = await fetch(`${siteUrl.replace(/\/$/, '')}${PATH}`, {
      method: 'POST',
      headers: {...PLATFORM_HEADERS, authorization: `Bearer ${siteKey}`, 'content-type': 'application/json'},
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        ip: report.ipBlock,
        reason: 'spam',
        note: 'Kept going over the form submit limits',
        hits: Math.max(1, Math.floor(report.count)),
      }),
    });
    return res.ok ? {ok: true} : {ok: false, reason: `http_${res.status}`};
  } catch {
    return {ok: false, reason: 'unreachable'};
  }
}

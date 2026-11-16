import Bowser from 'bowser';
import type {Context} from 'hono';

import {ipHashFor, respondentIp} from './crypto';

export type Device = 'desktop' | 'mobile' | 'tablet';

export interface RequestMeta {
  /** Keyed hash of the client IP (crypto.ts); null when unknown. Never the raw IP. */
  ipHash: string | null;
  /** ISO 3166-1 alpha-2 from Cloudflare's `cf-ipcountry`, or null. */
  country: string | null;
  device: Device | null;
  browser: string | null;
}

/**
 * Respondent metadata stored with a response (hashed IP, country at submit time, device and
 * browser). The site runs on Cloudflare, which sets `cf-ipcountry` itself (a client can't).
 */
export async function requestMeta(c: Context, secret: string): Promise<RequestMeta> {
  return {
    ipHash: await ipHashFor(secret, respondentIp(c)),
    country: countryOf(c.req.header('cf-ipcountry')),
    ...deviceOf(c.req.header('user-agent') ?? '', {
      mobile: c.req.header('sec-ch-ua-mobile'),
      brands: c.req.header('sec-ch-ua'),
    }),
  };
}

/** A two-letter code, or null (XX = unknown, T1 = Tor). */
export function countryOf(header: string | undefined): string | null {
  const v = header?.trim().toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null;
}

const BRAND_NAMES: Record<string, string> = {
  'google chrome': 'Chrome',
  'microsoft edge': 'Edge',
  opera: 'Opera',
  brave: 'Brave',
  yandex: 'Yandex',
  'samsung internet': 'Samsung Internet',
};

/** Device type and browser name from the User-Agent, refined by client hints when sent. */
export function deviceOf(ua: string, hints: {mobile?: string; brands?: string} = {}): {device: Device | null; browser: string | null} {
  let parsed: ReturnType<typeof Bowser.parse> | null = null;
  try {
    parsed = ua ? Bowser.parse(ua.slice(0, 1000)) : null;
  } catch {
    parsed = null;
  }
  const type = parsed?.platform.type;
  let device: Device | null = type === 'mobile' ? 'mobile' : type === 'tablet' ? 'tablet' : type === 'desktop' ? 'desktop' : null;
  if (hints.mobile === '?1') device = 'mobile';
  else if (hints.mobile === '?0' && device === null) device = 'desktop';

  let browser = parsed?.browser.name ?? null;
  if (hints.brands) {
    // Sec-CH-UA: "Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"
    const brands = [...hints.brands.slice(0, 1000).matchAll(/"([^"]{1,100})"\s*;\s*v="[^"]{0,50}"/g)].map(m => m[1]!);
    const named = brands.map(b => BRAND_NAMES[b.toLowerCase()]).find(Boolean);
    if (named) browser = named;
  }
  if (browser === 'Microsoft Edge') browser = 'Edge';
  return {device, browser: browser ? browser.slice(0, 40) : null};
}

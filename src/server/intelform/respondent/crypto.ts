import type {Context} from 'hono';

import {clientIp} from '../../../platform/auth/kit';
import {subjectHash} from '../../../platform/auth/keys';
import {config} from '../../../platform/config';
import {RespondentError} from './errors';

/**
 * Keys for the respondent flow, all derived from the site's ONE secret (`config.jwtSecret`,
 * docs/agent/auth.md) with HKDF under IntelForm's own salt and purpose, so a respondent token
 * can never be replayed as anything the template signs (and the reverse). WebCrypto only: this
 * runs on the Worker (no `node:crypto`). IntelForm's old APP_SECRET is gone.
 *
 * IP addresses go through the template's own keyed hash (`subjectHash`, purpose "subject-hash"):
 * the same fingerprint the auth core writes to `audit_events.ip_hash`, never the raw address.
 */

const encoder = new TextEncoder();
const SALT = encoder.encode('intelform-respondent-v1');

const keyCache = new Map<string, Promise<CryptoKey>>();

/** HMAC-SHA256 key for one purpose. Cached per secret+purpose (small, public-safe: a CryptoKey). */
export function respondentKey(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}\u0000${secret}`;
  let key = keyCache.get(id);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        {name: 'HKDF', hash: 'SHA-256', salt: SALT, info: encoder.encode(purpose)},
        base,
        256
      );
      return crypto.subtle.importKey('raw', bits, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    })();
    // Bounded: one entry per purpose (and per secret, which only changes on rotation).
    if (keyCache.size > 16) keyCache.clear();
    keyCache.set(id, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function hmacBase64Url(secret: string, purpose: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await respondentKey(secret, purpose), encoder.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

export async function hmacHex(secret: string, purpose: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await respondentKey(secret, purpose), encoder.encode(message));
  return toHex(new Uint8Array(sig));
}

/** Constant-time compare of two short ASCII strings (different lengths: false). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The site secret, or a 503 the respondent sees in words (the owner must finish setup). */
export function requireSecret(): string {
  const secret = config.jwtSecret;
  if (!secret) throw new RespondentError(503, 'auth_not_configured', 'This form can’t take responses right now. Try again later.');
  return secret;
}

/** The address Cloudflare saw (`cf-connecting-ip`), or null locally. Never `x-forwarded-for`. */
export function respondentIp(c: Context): string | null {
  const ip = clientIp(c);
  return ip === 'local' ? null : ip;
}

/** Stored with a response: the keyed hash of the full address (64 hex), or null when unknown. */
export async function ipHashFor(secret: string, ip: string | null): Promise<string | null> {
  return ip ? subjectHash(secret, 'ip', ip) : null;
}

/**
 * The caller's address BLOCK, the unit every respondent limit and block is about: an IPv4 address
 * as it is (/32), an IPv6 address cut to its /64 (one home or phone network: everything behind
 * it is one visitor), an IPv4-mapped IPv6 address as its IPv4 address. Null for anything that
 * isn't an IP address. Pure: shared with the Blocked visitors screen (an admin types an address).
 */
export function ipBlockOf(ip: string): string | null {
  const v = ip.trim().toLowerCase();
  if (!v || v.length > 64) return null;
  const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return v4.slice(1).every(o => Number(o) <= 255 && String(Number(o)) === o) ? v4.slice(1).join('.') : null;
  const bare = v.replace(/\/64$/, '');
  const mapped = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return ipBlockOf(mapped[1]!);
  if (!/^[0-9a-f:]+$/.test(bare) || (bare.match(/::/g) ?? []).length > 1) return null;
  const [head = '', tail] = bare.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** A block an admin may see in part (no permission to change settings): `203.0.•.•`, `2001:db8:•:•::/64`. */
export function maskIpBlock(block: string | null): string | null {
  if (!block) return null;
  if (!block.includes(':')) {
    const parts = block.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.•.•` : '•';
  }
  const groups = block.replace(/::\/64$/, '').split(':');
  return `${groups.slice(0, 2).join(':')}:•:•::/64`;
}

/** The key of an address block (never the block itself): what the limits and the block list use. */
export async function ipKeyOfBlock(secret: string, block: string): Promise<string> {
  return (await subjectHash(secret, 'ip', `block:${block}`)).slice(0, 40);
}

/**
 * Rate-limit key part for the caller: the keyed hash of their address block (`ipBlockOf`), or
 * "local" without one (local development, tests).
 */
export async function ipKeyFor(secret: string, ip: string | null): Promise<string> {
  return ip ? ipKeyOfBlock(secret, ipBlockOf(ip) ?? ip.trim().slice(0, 64)) : 'local';
}

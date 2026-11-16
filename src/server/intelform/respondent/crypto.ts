import type {Context} from 'hono';

import {clientIp, rateLimitIp} from '../../../platform/auth/kit';
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
 * Rate-limit key part for the caller: the keyed hash of their address block (IPv4 address, or the
 * IPv6 /56 the template's limits use), or "local" without one (local development, tests).
 */
export async function ipKeyFor(secret: string, ip: string | null): Promise<string> {
  return ip ? (await subjectHash(secret, 'ip', rateLimitIp(ip))).slice(0, 40) : 'local';
}

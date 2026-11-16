/**
 * Upload tokens for anonymous signature uploads. The uploads route hands one out with each
 * signature upload URL; the browser sends it back inside the answer (`{fileId, token}`), and the
 * submit route only accepts a signature whose token it can verify: proof that THIS site created
 * that file for THAT form's signature field a moment ago (docs/agent/files.md: never trust a file
 * id from the browser). HMAC-SHA-256 with a key derived from the site's JWT_SECRET for this one
 * purpose, so it never verifies anything else, and nothing else verifies it.
 */

export interface SignatureClaim {
  fileId: string;
  formId: string;
  fieldId: string;
  /** Expiry, Unix seconds. */
  exp: number;
}

const enc = new TextEncoder();

const toB64Url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64Url = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

const keys = new Map<string, Promise<CryptoKey>>();

async function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = (async () => {
      const root = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
      const derived = await crypto.subtle.sign('HMAC', root, enc.encode('intelform:signature-upload:v1'));
      return crypto.subtle.importKey('raw', derived, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
    })();
    keys.set(secret, key);
  }
  return key;
}

/** `<payload>.<mac>`, both base64url. */
export async function signUploadToken(secret: string, claim: SignatureClaim): Promise<string> {
  const payload = toB64Url(enc.encode(JSON.stringify([claim.fileId, claim.formId, claim.fieldId, claim.exp])));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), enc.encode(payload)));
  return `${payload}.${toB64Url(mac)}`;
}

/** The claim when the token is genuine and not expired; null otherwise. */
export async function verifyUploadToken(
  secret: string,
  token: unknown,
  now: number = Date.now()
): Promise<SignatureClaim | null> {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, macText, extra] = token.split('.');
  if (!payload || !macText || extra !== undefined) return null;
  const mac = fromB64Url(macText);
  if (!mac || mac.length !== 32) return null;
  const ok = await crypto.subtle.verify(
    'HMAC',
    await keyFor(secret),
    mac as Uint8Array<ArrayBuffer>,
    enc.encode(payload)
  );
  if (!ok) return null;
  const raw = fromB64Url(payload);
  if (!raw) return null;
  let parts: unknown;
  try {
    parts = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parts) || parts.length !== 4) return null;
  const [fileId, formId, fieldId, exp] = parts as unknown[];
  if (typeof fileId !== 'string' || typeof formId !== 'string' || typeof fieldId !== 'string' || typeof exp !== 'number') return null;
  if (exp * 1000 < now) return null;
  return {fileId, formId, fieldId, exp};
}

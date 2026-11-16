import {randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {env} from '../integration/support/cloudflare-workers';
import {completeImageUpload, startImageUpload} from '../../src/server/intelform/uploads/images';
import {crc32, validatePng} from '../../src/server/intelform/uploads/png';
import {addressBlock, callerKey} from '../../src/server/intelform/uploads/rate-limit';
import {
  checkImage,
  checkSignature,
  imageFileName,
  maxBytesFor,
  purposeOfImageName,
  SIGNATURE_MAX_BYTES,
} from '../../src/server/intelform/uploads/rules';
import {
  answersSignatureFileIds,
  claimSignatures,
  signatureViewPath,
  storedSignatureFileId,
} from '../../src/server/intelform/uploads/signatures';
import {isCleanSvg, looksLikeSvg, sniffImageType} from '../../src/server/intelform/uploads/sniff';
import {signUploadToken, verifyUploadToken} from '../../src/server/intelform/uploads/token';

// ------------------------------------------------------------------ PNG fixtures (from the old app)

function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function ihdr(width: number, height: number, depth = 8, colour = 6, interlace = 0): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d.set([depth, colour, 0, 0, interlace], 8);
  return chunk('IHDR', d);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function rgbaRows(width: number, height: number, noise = false): Buffer {
  const row = 1 + width * 4;
  const raw = noise ? randomBytes(height * row) : Buffer.alloc(height * row);
  for (let y = 0; y < height; y++) raw[y * row] = 0;
  return raw;
}

function rgbaChunks(width: number, height: number, opts: {parts?: number; noise?: boolean; before?: Buffer[]} = {}): Buffer[] {
  const z = deflateSync(rgbaRows(width, height, opts.noise));
  const parts = opts.parts ?? 1;
  const size = Math.ceil(z.length / parts);
  const idats: Buffer[] = [];
  for (let i = 0; i < z.length; i += size) idats.push(chunk('IDAT', z.subarray(i, i + size)));
  return [ihdr(width, height), ...(opts.before ?? []), ...idats, chunk('IEND')];
}

const png = (chunks: Buffer[]) => Buffer.concat([PNG_SIG, ...chunks]);

const canvasPng = (width = 600, height = 176, noise = false) =>
  png(
    rgbaChunks(width, height, {
      parts: 3,
      noise,
      before: [chunk('sRGB', Buffer.from([0])), chunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]))],
    })
  );

const reason = async (buf: Uint8Array) => {
  try {
    await validatePng(buf);
    return 'ok';
  } catch (err) {
    return (err as Error).message;
  }
};

const TINY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

describe('validatePng (Worker port)', () => {
  it('matches the standard CRC-32', () => {
    expect(crc32(Buffer.from('IEND'))).toBe(0xae426082);
  });

  it('accepts canvas-style PNGs', async () => {
    expect(await validatePng(TINY)).toEqual({width: 1, height: 1});
    expect(await validatePng(canvasPng())).toEqual({width: 600, height: 176});
    expect(await validatePng(canvasPng(1400, 352, true))).toEqual({width: 1400, height: 352});
    const icc = chunk('iCCP', Buffer.concat([Buffer.from('ICC\0\0'), deflateSync(Buffer.alloc(3000, 7))]));
    expect(await reason(png(rgbaChunks(10, 10, {before: [icc, chunk('iDOT', Buffer.alloc(28))]})))).toBe('ok');
  });

  it('accepts a palette image with transparency', async () => {
    const raw = Buffer.from([0, 0b00010000, 0, 0b01000000]);
    const chunks = [ihdr(2, 2, 2, 3), chunk('PLTE', Buffer.alloc(9)), chunk('tRNS', Buffer.from([0])), chunk('IDAT', deflateSync(raw)), chunk('IEND')];
    expect(await reason(png(chunks))).toBe('ok');
  });

  it('rejects anything that is not a plain PNG image', async () => {
    const ok = rgbaChunks(4, 4);
    const [head, idat, iend] = ok as [Buffer, Buffer, Buffer];
    expect(await reason(Buffer.from('<svg></svg>'.padEnd(80)))).toBe('not a PNG');
    expect(await reason(png([head, chunk('tEXt', Buffer.from('Comment\0hello')), idat, iend]))).toBe('chunk tEXt not allowed');
    expect(await reason(png([head, idat, chunk('zzZz', Buffer.alloc(10)), iend]))).toBe('chunk zzZz not allowed');
    expect(await reason(png([head, idat, chunk('pHYs', Buffer.alloc(9)), iend]))).toBe('pHYs after IDAT');
    expect(await reason(png([head, chunk('pHYs', Buffer.alloc(9)), chunk('pHYs', Buffer.alloc(9)), idat, iend]))).toBe('second pHYs');
    expect(await reason(png([head, chunk('pHYs', Buffer.alloc(4000)), idat, iend]))).toBe('pHYs too large');
    expect(await reason(png([head, chunk('iCCP', Buffer.alloc(70_000)), idat, iend]))).toBe('iCCP too large');
    expect(await reason(Buffer.concat([png(ok), Buffer.from('trailing')]))).toBe('bytes after IEND');
    expect(await reason(png([head, idat]))).toMatch(/IEND|truncated/);
    expect(await reason(png([idat, head, iend]))).toBe('IHDR must come first');
    expect(await reason(png([head, iend]))).toBe('missing IDAT');
    const broken = png(ok);
    broken[broken.length - 20]! ^= 0xff;
    expect(await reason(broken)).toMatch(/bad CRC/);
    const z = deflateSync(rgbaRows(4, 4));
    expect(
      await reason(png([head, chunk('IDAT', z.subarray(0, 5)), chunk('sRGB', Buffer.from([0])), chunk('IDAT', z.subarray(5)), iend]))
    ).toMatch(/after IDAT|not consecutive/);
  });

  it('rejects bad headers', async () => {
    const body = rgbaChunks(4, 4).slice(1);
    expect(await reason(png([ihdr(5000, 10), ...body]))).toBe('bad image size');
    expect(await reason(png([ihdr(0, 10), ...body]))).toBe('bad image size');
    expect(await reason(png([ihdr(4, 4, 4, 6), ...body]))).toBe('bad colour type or bit depth');
    expect(await reason(png([ihdr(4, 4, 8, 5), ...body]))).toBe('bad colour type or bit depth');
    expect(await reason(png([ihdr(4, 4, 8, 6, 1), ...body]))).toBe('interlaced');
    expect(await reason(png([ihdr(4096, 4096, 16, 6), ...body]))).toBe('image too large');
  });

  it('requires the image data to match the header exactly', async () => {
    const [head, , iend] = rgbaChunks(4, 4) as [Buffer, Buffer, Buffer];
    const idat = (raw: Buffer) => chunk('IDAT', deflateSync(raw));
    expect(await reason(png([head, idat(rgbaRows(4, 3)), iend]))).toBe('image data too short');
    expect(await reason(png([head, idat(rgbaRows(4, 5)), iend]))).toBe('image data too long');
    const badFilter = rgbaRows(4, 4);
    badFilter[17] = 9;
    expect(await reason(png([head, idat(badFilter), iend]))).toBe('bad filter type');
    expect(
      await reason(png([head, chunk('IDAT', Buffer.concat([deflateSync(rgbaRows(4, 4)), Buffer.from('hidden')])), iend]))
    ).toBe('bytes after image data');
    expect(await reason(png([head, chunk('IDAT', Buffer.from('not zlib at all')), iend]))).toBe('bad image data');
  });

  it('stops a zip bomb early', async () => {
    const bomb = png([ihdr(1, 1), chunk('IDAT', deflateSync(Buffer.alloc(64 * 1024 * 1024))), chunk('IEND')]);
    const started = Date.now();
    expect(await reason(bomb)).toBe('image data too long');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// ------------------------------------------------------------------ sniffing

describe('sniffImageType / SVG checks', () => {
  it('recognises the accepted image types by their bytes', () => {
    expect(sniffImageType(TINY)).toBe('image/png');
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a\x01\x00'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImageType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageType(Buffer.from('PK\x03\x04zip'))).toBeNull();
  });

  it('accepts a plain SVG with fragment references', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">' +
      '<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use xlink:href="#g"/></svg>';
    expect(looksLikeSvg(svg)).toBe(true);
    expect(isCleanSvg(svg)).toBe(true);
  });

  it('refuses active or linking SVG content', () => {
    const wrap = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`;
    expect(isCleanSvg(wrap('<script>alert(1)</script>'))).toBe(false);
    expect(isCleanSvg(wrap('<rect/>', ' onload="alert(1)"'))).toBe(false);
    expect(isCleanSvg(wrap('<foreignObject><div/></foreignObject>'))).toBe(false);
    expect(isCleanSvg(wrap('<image href="https://evil.example/x.png"/>'))).toBe(false);
    expect(isCleanSvg(wrap('<a xlink:href="javascript:alert(1)"><rect/></a>'))).toBe(false);
    expect(isCleanSvg(wrap('<style>@import url(https://x.example/a.css);</style>'))).toBe(false);
    expect(isCleanSvg(wrap('<rect style="fill:url(https://x.example/a)"/>'))).toBe(false);
    expect(isCleanSvg(wrap('<set attributeName="href" to="javascript:1"/>'))).toBe(false);
    expect(isCleanSvg(wrap('<x:script xmlns:x="http://www.w3.org/2000/svg"/>'))).toBe(false);
    expect(isCleanSvg(wrap('<g xmlns="http://www.w3.org/1999/xhtml"><p/></g>'))).toBe(false);
    expect(isCleanSvg('<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')).toBe(false);
    expect(isCleanSvg('not an svg')).toBe(false);
  });
});

// ------------------------------------------------------------------ rules

describe('upload rules', () => {
  it('checks type and size per purpose (browser and route agree)', () => {
    expect(checkImage({type: 'image/png', size: 1000}, 'image')).toBeNull();
    expect(checkImage({type: 'image/gif', size: 1000}, 'image')).toBeNull();
    expect(checkImage({type: 'image/gif', size: 1000}, 'og')).toMatch(/isn’t supported/);
    expect(checkImage({type: 'image/svg+xml', size: 1000}, 'logo')).toBeNull();
    expect(checkImage({type: 'image/svg+xml', size: 1000}, 'image')).toMatch(/isn’t supported/);
    expect(checkImage({type: 'image/svg+xml', size: 2 * 1024 * 1024}, 'logo')).toMatch(/too large/);
    expect(checkImage({type: 'image/png', size: 6 * 1024 * 1024}, 'logo')).toMatch(/too large/);
    expect(checkImage({type: 'image/png', size: 0}, 'logo')).toMatch(/empty/);
    expect(checkImage({type: 'text/html', size: 10}, 'logo')).toMatch(/isn’t supported/);
    expect(maxBytesFor('logo', 'image/svg+xml')).toBe(1024 * 1024);
  });

  it('names stored images by purpose and reads the purpose back', () => {
    expect(imageFileName('logo', 'image/svg+xml')).toBe('logo.svg');
    expect(imageFileName('og', 'image/jpeg')).toBe('og.jpg');
    expect(purposeOfImageName('favicon.png')).toBe('favicon');
    expect(purposeOfImageName('signature.png')).toBeNull();
    expect(purposeOfImageName('logo.html')).toBeNull();
  });

  it('keeps signatures small PNGs', () => {
    expect(checkSignature({type: 'image/png', size: 40_000})).toBeNull();
    expect(checkSignature({type: 'image/jpeg', size: 40_000})).toMatch(/PNG/);
    expect(checkSignature({type: 'image/png', size: SIGNATURE_MAX_BYTES + 1})).toMatch(/too large/);
    expect(checkSignature({type: 'image/png', size: 0})).toMatch(/empty/);
  });

  it('pools IPv6 callers by /64 and hashes addresses', async () => {
    expect(addressBlock('203.0.113.9')).toBe('203.0.113.9');
    expect(addressBlock('2001:db8:0:1:aaaa::1')).toBe('2001:db8:0:1::/64');
    expect(addressBlock('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressBlock('::ffff:198.51.100.7')).toBe('198.51.100.7');
    const a = await callerKey('s'.repeat(40), '2001:db8:0:1::1');
    const b = await callerKey('s'.repeat(40), '2001:db8:0:1::2');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('2001');
    expect(await callerKey('s'.repeat(40), null)).toBe('unknown');
  });
});

// ------------------------------------------------------------------ tokens

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnop';
const FILE_A = 'file_' + 'a'.repeat(26);
const FILE_B = 'file_' + 'b'.repeat(26);
const FORM = '00000000-0000-4000-8000-00000000f001';
const later = () => Math.floor(Date.now() / 1000) + 3600;

describe('upload tokens', () => {
  it('round-trips and binds file, form and field', async () => {
    const token = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    expect(await verifyUploadToken(SECRET, token)).toMatchObject({fileId: FILE_A, formId: FORM, fieldId: 'sig'});
  });

  it('refuses tampered, foreign, expired and malformed tokens', async () => {
    const token = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    const [payload, mac] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify([FILE_B, FORM, 'sig', later()])).toString('base64url');
    expect(await verifyUploadToken(SECRET, `${forged}.${mac}`)).toBeNull();
    expect(await verifyUploadToken('another-secret-0123456789-abcdefghijklmn', token)).toBeNull();
    expect(await verifyUploadToken(SECRET, `${payload}.${mac}.x`)).toBeNull();
    expect(await verifyUploadToken(SECRET, 'nonsense')).toBeNull();
    expect(await verifyUploadToken(SECRET, 42)).toBeNull();
    const old = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: 1000});
    expect(await verifyUploadToken(SECRET, old)).toBeNull();
  });
});

// ------------------------------------------------------------------ platform-backed helpers (fetch mocked)

const PLATFORM = 'https://platform.example.test';
const STORAGE = 'https://storage.example.test';

interface FakeFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  visibility: 'private' | 'public';
  status: 'pending' | 'ready';
  bytes: Uint8Array;
}

let files: Map<string, FakeFile>;
let deleted: string[];

const asStored = (f: FakeFile) => ({
  id: f.id,
  name: f.name,
  contentType: f.contentType,
  size: f.size,
  visibility: f.visibility,
  status: f.status,
  environment: 'staging',
  createdAt: new Date().toISOString(),
  completedAt: null,
});

const ok = (data: unknown) => new Response(JSON.stringify({data}), {status: 200, headers: {'content-type': 'application/json'}});
const err = (status: number, code: string) => new Response(JSON.stringify({errors: [{code, message: code}]}), {status});

function fakePlatform(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === STORAGE) {
    const f = files.get(url.pathname.slice(1));
    if (!f) return Promise.resolve(new Response('nope', {status: 404}));
    const range = new Headers(init?.headers).get('range');
    const m = range ? /bytes=0-(\d+)/.exec(range) : null;
    const body = m ? f.bytes.subarray(0, Number(m[1]) + 1) : f.bytes;
    return Promise.resolve(new Response(body as Uint8Array<ArrayBuffer>, {status: m ? 206 : 200}));
  }
  const path = url.pathname.replace('/api/site/v1/files', '');
  if (path === '/uploads' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as {name: string; contentType: string; size: number; visibility?: 'public' | 'private'};
    const id = 'file_' + 'c'.repeat(26);
    const f: FakeFile = {id, ...body, visibility: body.visibility ?? 'private', status: 'pending', bytes: new Uint8Array()};
    files.set(id, f);
    return Promise.resolve(ok({file: asStored(f), upload: {method: 'PUT', url: `${STORAGE}/${id}`, headers: {}, expiresAt: '', direct: true}}));
  }
  const m = /^\/(file_[0-9a-z]{26})(\/(complete|url|delete))?$/.exec(path);
  const f = m ? files.get(m[1]!) : undefined;
  if (!m || !f) return Promise.resolve(err(404, 'E_FILE_NOT_FOUND'));
  if (!m[3]) return Promise.resolve(ok({file: asStored(f)}));
  if (m[3] === 'complete') {
    if (f.bytes.length !== f.size) return Promise.resolve(err(400, 'E_FILE_SIZE_MISMATCH'));
    f.status = 'ready';
    return Promise.resolve(ok({file: asStored(f)}));
  }
  if (m[3] === 'url') return Promise.resolve(ok({url: `${STORAGE}/${f.id}`, expiresAt: ''}));
  deleted.push(f.id);
  files.delete(f.id);
  return Promise.resolve(ok({deleted: true}));
}

function addFile(f: Partial<FakeFile> & {id: string; bytes: Uint8Array}): FakeFile {
  const file: FakeFile = {
    name: 'signature.png',
    contentType: 'image/png',
    size: f.bytes.length,
    // Signature uploads are private (personal data); image tests say 'public' themselves.
    visibility: 'private',
    status: 'pending',
    ...f,
  };
  files.set(file.id, file);
  return file;
}

describe('signatures and images against the platform (mocked)', () => {
  beforeEach(() => {
    files = new Map();
    deleted = [];
    env.SITE_URL = PLATFORM;
    env.SITE_KEY = 'stk_test_stub';
    env.JWT_SECRET = SECRET;
    vi.stubGlobal('fetch', vi.fn(fakePlatform));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete env.SITE_URL;
    delete env.SITE_KEY;
    delete env.JWT_SECRET;
  });

  const fields = [
    {id: 'name', type: 'short_text'},
    {id: 'sig', type: 'signature'},
  ];
  const claim = async (answers: Record<string, unknown>) =>
    claimSignatures('https://site.example.test/site-api/public/forms/x/submit', {
      formId: FORM,
      fields,
      answers,
      invalidMessage: 'Sign again in the box',
    });

  it('claims a genuine signature: completes, validates and stores its private {fileId}', async () => {
    addFile({id: FILE_A, bytes: canvasPng()});
    const token = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    const answers: Record<string, unknown> = {name: 'Ann', sig: {fileId: FILE_A, token}};
    const res = await claim(answers);
    expect(res).toEqual({ok: true, fileIds: [FILE_A]});
    expect(answers.sig).toEqual({fileId: FILE_A});
    expect(files.get(FILE_A)?.status).toBe('ready');
    expect(storedSignatureFileId(answers.sig)).toBe(FILE_A);
    expect(answersSignatureFileIds(answers)).toEqual([FILE_A]);
  });

  it('leaves forms without signature answers alone', async () => {
    expect(await claim({name: 'Ann'})).toEqual({ok: true, fileIds: []});
  });

  it('refuses a token for another field, form or file, or a reused file', async () => {
    addFile({id: FILE_A, bytes: canvasPng()});
    const otherField = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'other', exp: later()});
    expect(await claim({sig: {fileId: FILE_A, token: otherField}})).toMatchObject({ok: false, status: 422, fields: {sig: ['Sign again in the box']}});
    const otherFile = await signUploadToken(SECRET, {fileId: FILE_B, formId: FORM, fieldId: 'sig', exp: later()});
    expect(await claim({sig: {fileId: FILE_A, token: otherFile}})).toMatchObject({ok: false, status: 422});
    expect(await claim({sig: {url: 'https://evil.example/x.png'}})).toMatchObject({ok: false, status: 422});
    expect(await claim({sig: {fileId: FILE_A}})).toMatchObject({ok: false, status: 422});
    // Already claimed by an earlier submit.
    files.get(FILE_A)!.status = 'ready';
    const good = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    expect(await claim({sig: {fileId: FILE_A, token: good}})).toMatchObject({ok: false, status: 422});
    expect(deleted).toEqual([]);
  });

  it('deletes a stored file that is not a plain PNG', async () => {
    const bad = png([...rgbaChunks(4, 4).slice(0, 1), chunk('tEXt', Buffer.from('x\0y')), ...rgbaChunks(4, 4).slice(1)]);
    addFile({id: FILE_A, bytes: bad});
    const token = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    const answers = {sig: {fileId: FILE_A, token}};
    expect(await claim(answers)).toMatchObject({ok: false, status: 422});
    expect(deleted).toEqual([FILE_A]);
    expect(answers.sig).toEqual({fileId: FILE_A, token});
  });

  it('refuses a PUBLIC file: signatures are personal data, only private uploads are claimed', async () => {
    addFile({id: FILE_A, visibility: 'public', bytes: canvasPng()});
    const token = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    expect(await claim({sig: {fileId: FILE_A, token}})).toMatchObject({ok: false, status: 422});
    expect(files.get(FILE_A)?.status).toBe('pending');
  });

  it('refuses a file that is not a signature upload', async () => {
    addFile({id: FILE_A, name: 'logo.png', bytes: canvasPng()});
    const token = await signUploadToken(SECRET, {fileId: FILE_A, formId: FORM, fieldId: 'sig', exp: later()});
    expect(await claim({sig: {fileId: FILE_A, token}})).toMatchObject({ok: false, status: 422});
  });

  it('starts a public image upload named by purpose and refuses wrong types first', async () => {
    const bad = await startImageUpload('https://site.example.test/', {name: 'x.svg', contentType: 'image/svg+xml', size: 10, purpose: 'og'});
    expect(bad).toMatchObject({ok: false, status: 422});
    const grant = await startImageUpload('https://site.example.test/', {name: 'Me.PNG', contentType: 'image/png', size: 10, purpose: 'logo'});
    expect(grant.ok).toBe(true);
    const f = [...files.values()][0]!;
    expect(f).toMatchObject({name: 'logo.png', visibility: 'public', contentType: 'image/png'});
  });

  it('completes an image and answers its public link', async () => {
    addFile({id: FILE_A, name: 'image.png', visibility: 'public', bytes: canvasPng()});
    const res = await completeImageUpload('https://site.example.test/', FILE_A, () => true);
    expect(res).toEqual({ok: true, data: {url: `/__platform/files/${FILE_A}/image.png`, contentType: 'image/png', size: files.get(FILE_A)!.size}});
  });

  it('deletes an image whose bytes are not what it claimed', async () => {
    addFile({id: FILE_A, name: 'image.png', visibility: 'public', bytes: Buffer.from('<html><script>alert(1)</script></html>')});
    const res = await completeImageUpload('https://site.example.test/', FILE_A, () => true);
    expect(res).toMatchObject({ok: false, status: 422, code: 'invalid_file'});
    expect(deleted).toEqual([FILE_A]);
  });

  it('deletes an SVG logo with active content', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    addFile({id: FILE_A, name: 'logo.svg', contentType: 'image/svg+xml', visibility: 'public', bytes: svg});
    expect(await completeImageUpload('https://site.example.test/', FILE_A, () => true)).toMatchObject({ok: false, status: 422});
    expect(deleted).toEqual([FILE_A]);
  });

  it('only completes this route’s public images, for viewers allowed that purpose', async () => {
    addFile({id: FILE_A, bytes: canvasPng()}); // a signature (public, but not an image purpose)
    expect(await completeImageUpload('https://site.example.test/', FILE_A, () => true)).toMatchObject({ok: false, status: 404});
    addFile({id: FILE_B, name: 'favicon.png', visibility: 'public', bytes: canvasPng()});
    expect(await completeImageUpload('https://site.example.test/', FILE_B, p => p !== 'favicon')).toMatchObject({ok: false, status: 403});
    expect(files.get(FILE_A)?.status).toBe('pending');
    expect(files.get(FILE_B)?.status).toBe('pending');
  });

  it('builds the dashboard view path of a signature', () => {
    expect(signatureViewPath('00000000-0000-4000-8000-0000000000aa', 'sig')).toBe(
      '/site-api/uploads/signatures/00000000-0000-4000-8000-0000000000aa/sig'
    );
  });
});

// ------------------------------------------------------------------ route input checks (before any lookup)

describe('uploads routes refuse bad input before any lookup', () => {
  const post = async (path: string, body: unknown) => {
    const {uploadsRoutes} = await import('../../src/server/routes/uploads');
    return uploadsRoutes.request(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  };

  it('signature: unknown form or field shape is a 404, a wrong file a 422', async () => {
    expect((await post('/signature', {formId: 'nope', fieldId: 'sig', contentType: 'image/png', size: 10})).status).toBe(404);
    expect((await post('/signature', {formId: FORM, fieldId: '../x', contentType: 'image/png', size: 10})).status).toBe(404);
    const wrongType = await post('/signature', {formId: FORM, fieldId: 'sig', contentType: 'image/svg+xml', size: 10});
    expect(wrongType.status).toBe(422);
    expect(await wrongType.json()).toMatchObject({error: 'invalid_input', fields: {sig: ['A signature must be a PNG image.']}});
    expect((await post('/signature', {formId: FORM, fieldId: 'sig', contentType: 'image/png', size: SIGNATURE_MAX_BYTES + 1})).status).toBe(422);
  });

  it('images: purpose, type and size are checked first', async () => {
    expect((await post('/', {name: 'a.png', contentType: 'image/png', size: 10, purpose: 'avatar'})).status).toBe(422);
    const big = await post('/', {name: 'a.png', contentType: 'image/png', size: 50 * 1024 * 1024, purpose: 'image'});
    expect(big.status).toBe(422);
    expect(await big.json()).toMatchObject({fields: {file: [expect.stringMatching(/too large/)]}});
    expect((await post('/file_bad/complete', {})).status).toBe(404);
  });
});

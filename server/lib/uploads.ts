import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { MAX_UPLOAD_BYTES, SVG_PURPOSES, type UploadPurpose } from '../../shared/settings-app'
import { env } from '../env'
import { ApiError } from './errors'

/**
 * Image storage. With BUNNY_STORAGE_ZONE + BUNNY_STORAGE_KEY + BUNNY_CDN_URL set, files go to
 * Bunny Edge Storage over its HTTP API (server-side PUT with AccessKey and a SHA-256
 * Checksum; credentials never reach the browser). Otherwise a local-disk driver writes to
 * UPLOADS_DIR and the server serves the files at /api/uploads/files/* (and /uploads/*).
 */

export const LOCAL_URL_PREFIX = '/api/uploads/files/'

interface StorageDriver {
  name: 'bunny' | 'local'
  put(path: string, buf: Buffer, contentType: string): Promise<string>
  remove(path: string): Promise<void>
  publicBase: string
}

function bunnyDriver(zone: string, key: string, cdn: string): StorageDriver {
  const host = env.BUNNY_STORAGE_REGION && env.BUNNY_STORAGE_REGION !== 'de' ? `${env.BUNNY_STORAGE_REGION}.storage.bunnycdn.com` : 'storage.bunnycdn.com'
  const base = `https://${host}/${encodeURIComponent(zone)}/`
  const publicBase = cdn.replace(/\/+$/, '') + '/'
  return {
    name: 'bunny',
    publicBase,
    async put(path, buf, contentType) {
      const res = await fetch(base + path, {
        method: 'PUT',
        headers: {
          AccessKey: key,
          'Content-Type': contentType,
          Checksum: createHash('sha256').update(buf).digest('hex').toUpperCase(),
        },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`Bunny storage answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
      return publicBase + path
    },
    async remove(path) {
      const res = await fetch(base + path, { method: 'DELETE', headers: { AccessKey: key }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok && res.status !== 404) throw new Error(`Bunny storage answered ${res.status} to a delete`)
    },
  }
}

const localRoot = resolve(env.UPLOADS_DIR)

/** Absolute path of a stored local file, or null if `rel` tries to leave the uploads folder. */
export function localFilePath(rel: string): string | null {
  const full = resolve(localRoot, rel)
  return full.startsWith(localRoot + sep) ? full : null
}

const localDriver: StorageDriver = {
  name: 'local',
  publicBase: LOCAL_URL_PREFIX,
  async put(path, buf) {
    const full = localFilePath(path)
    if (!full) throw new Error('Invalid upload path')
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, buf)
    return LOCAL_URL_PREFIX + path
  },
  async remove(path) {
    const full = localFilePath(path)
    if (full) await rm(full, { force: true })
  },
}

export function storageDriver(): StorageDriver {
  const { BUNNY_STORAGE_ZONE: zone, BUNNY_STORAGE_KEY: key, BUNNY_CDN_URL: cdn } = env
  return zone && key && cdn ? bunnyDriver(zone, key, cdn) : localDriver
}

export function storageStatus() {
  const d = storageDriver()
  return { driver: d.name, zone: d.name === 'bunny' ? (env.BUNNY_STORAGE_ZONE ?? null) : null, publicBaseUrl: d.publicBase }
}

function checkPath(path: string): string {
  const clean = path.replace(/^\/+/, '')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(clean) || clean.includes('..') || clean.length > 300) throw new Error('Invalid upload path')
  return clean
}

/** Low-level write of already-validated bytes (e.g. a signature PNG the server drew). Returns the public URL. */
export async function storeBuffer(buf: Buffer, contentType: string, path: string): Promise<{ url: string }> {
  const url = await storageDriver().put(checkPath(path), buf, contentType)
  return { url }
}

/** Settings "Test upload": writes and deletes a 1-byte file. */
export async function testStorage(): Promise<{ driver: 'bunny' | 'local' }> {
  const d = storageDriver()
  const path = `intelform/_test/${randomUUID()}.txt`
  await d.put(path, Buffer.from('1'), 'text/plain')
  await d.remove(path)
  return { driver: d.name }
}

// ---------------------------------------------------------------------------
// Image validation
// ---------------------------------------------------------------------------

const RASTER: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

export interface UploadInput {
  /** A web File from multipart parsing, or raw bytes. */
  file: Blob | Buffer
}

const looksLikeSvg = (buf: Buffer) => {
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '')
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)
}

/**
 * Validates and stores an uploaded image. The client's type and extension are never trusted:
 * bytes are sniffed. png, jpeg, webp and gif are accepted for every purpose; SVG only for
 * logo and favicon, and only if sanitising it changes nothing. 5 MB max.
 */
export async function storeImage(file: Blob | Buffer, purpose: UploadPurpose): Promise<{ url: string; contentType: string; size: number }> {
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(await file.arrayBuffer())
  if (buf.length === 0) throw new ApiError(422, 'invalid_file', 'That file is empty')
  if (buf.length > MAX_UPLOAD_BYTES) throw new ApiError(413, 'file_too_large', 'Images can be up to 5 MB. Use a smaller file.')

  const sniffed = await fileTypeFromBuffer(buf)
  let contentType: string
  let ext: string
  if (sniffed && RASTER[sniffed.mime]) {
    contentType = sniffed.mime
    ext = RASTER[sniffed.mime]
  } else if ((!sniffed || sniffed.mime === 'application/xml') && looksLikeSvg(buf)) {
    // file-type reports an SVG that starts with an <?xml …?> declaration as application/xml.
    if (!SVG_PURPOSES.includes(purpose)) throw new ApiError(415, 'unsupported_type', 'SVG works only for the logo and favicon. Use PNG, JPEG, WebP or GIF.')
    await assertCleanSvg(buf.toString('utf8'))
    contentType = 'image/svg+xml'
    ext = 'svg'
  } else {
    throw new ApiError(415, 'unsupported_type', 'Use a PNG, JPEG, WebP or GIF image')
  }

  const path = `intelform/${purpose}/${randomUUID()}.${ext}`
  try {
    const { url } = await storeBuffer(buf, contentType, path)
    return { url, contentType, size: buf.length }
  } catch (err) {
    throw Object.assign(new ApiError(502, 'storage_failed', 'The image couldn’t be saved. Try again, or check Storage in Settings.'), { cause: err })
  }
}

/** Elements that run script, embed other documents or swap content at run time. */
const ACTIVE_SVG_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'handler', 'listener', 'set', 'animate', 'animatemotion', 'animatetransform', 'discard'])
const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
/** CSS that loads something: @import, or url() pointing anywhere but a fragment (#id) in the same file. */
const EXTERNAL_CSS = /@import|url\(\s*(?:['"]\s*)?(?!#)[^)\s'"]/i

/**
 * Rejects an SVG with scripts, event handlers, foreign objects, animation of attributes or any
 * reference outside the file (href, xlink:href, src, CSS url() or @import). Two independent checks:
 *
 * 1. DOMPurify (SVG profile, HTML parser) must remove nothing.
 * 2. The file is parsed as XML (how browsers read image/svg+xml, entities and CDATA included)
 *    and every element, attribute and style text is inspected. A file that isn't well-formed
 *    XML is rejected, so the two parsers can't disagree about what the file contains.
 */
export async function assertCleanSvg(svg: string): Promise<void> {
  // jsdom is heavy: load it only when an SVG is actually uploaded.
  const [{ JSDOM }, { default: createDOMPurify }] = await Promise.all([import('jsdom'), import('dompurify')])
  const { window } = new JSDOM('')
  const unsafe = () => new ApiError(422, 'unsafe_svg', 'This SVG contains scripts, links or other active content. Export a plain SVG or use a PNG.')
  try {
    const purify = createDOMPurify(window as never)
    purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
    // Ignored removals: DOMPurify's own <body> wrapper; <use> (its target is checked below);
    // editor metadata such as inkscape:version, xmlns:svg or <sodipodi:namedview>. Anything
    // namespaced is inert under the HTML parser and is judged by the XML pass below.
    const removed = purify.removed.filter((r) => {
      if ('element' in r && r.element) {
        const name = (r.element as Element).nodeName ?? ''
        return !/^(BODY|HTML|HEAD|USE)$/i.test(name) && !name.includes(':')
      }
      const attr = (r as { attribute?: Attr | null }).attribute?.name ?? ''
      return !(attr.includes(':') && !/^xlink:/i.test(attr))
    }).length
    if (removed > 0) throw unsafe()

    const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) throw unsafe()
    // An internal DTD subset can declare entities (expansion bombs, hidden markup).
    if (/<!ENTITY/i.test(svg) || (doc.doctype && /\[/.test(svg.slice(0, Math.max(0, svg.indexOf('<svg')))))) throw unsafe()
    for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
      // In XML, an element in the XHTML or MathML namespace is live HTML (script, iframe, form…).
      if (el.namespaceURI === XHTML_NS || el.namespaceURI === MATHML_NS) throw unsafe()
      if (ACTIVE_SVG_ELEMENTS.has(el.localName.toLowerCase())) throw unsafe()
      if (el.localName.toLowerCase() === 'style' && EXTERNAL_CSS.test(el.textContent ?? '')) throw unsafe()
      for (const attr of Array.from(el.attributes)) {
        const name = attr.localName.toLowerCase()
        const value = attr.value.trim()
        if (name.startsWith('on')) throw unsafe()
        if ((name === 'href' || name === 'src') && value && !value.startsWith('#')) throw unsafe()
        if (EXTERNAL_CSS.test(value)) throw unsafe()
      }
    }
  } finally {
    window.close()
  }
}

/** Decodes the rest of a /files/ or /uploads/ URL path; null when the escapes are malformed. */
export function decodeUploadPath(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/** Reads a locally stored file for serving; null when missing. */
export async function readLocalFile(rel: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const full = localFilePath(rel)
  if (!full) return null
  try {
    if (!(await stat(full)).isFile()) return null
    const buf = await readFile(full)
    return { buf, contentType: contentTypeFor(rel) }
  } catch {
    return null
  }
}

export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (
    { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', txt: 'text/plain' }[ext] ??
    'application/octet-stream'
  )
}

export const localUploadsRoot = localRoot

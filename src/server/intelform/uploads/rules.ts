/**
 * IntelForm's upload limits: ONE place for the routes, the browser checks and the pickers' help
 * text (docs/agent/files.md "Your own limits"). Browser-safe: no server imports, so the portal
 * (`src/portal/intelform/upload.ts`) and the respondent page (`src/respondent/upload.ts`) read
 * the same numbers the routes enforce.
 *
 * Two kinds of file:
 * - IMAGES a team member picks for a form or the app (logo, favicon, question / picture-choice
 *   image, social preview image). Public: they show on public forms and pages. Editors only.
 * - SIGNATURES a respondent draws. Public with an unguessable id (as in the old app), stored as
 *   {url}; anonymous, rate limited, tied to one live form's signature field by a signed token.
 */

export const IMAGE_PURPOSES = ['logo', 'favicon', 'image', 'og'] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

export const MB = 1024 * 1024;

export interface ImageRule {
  /** Content types accepted for this purpose (all inside the platform's ALLOWED_FILE_TYPES). */
  types: readonly string[];
  /** Largest file. */
  maxBytes: number;
  /** For the picker's help text and the error message. */
  help: string;
}

/** SVG has its own, smaller cap: the server reads the whole file to check it. */
export const SVG_MAX_BYTES = 1 * MB;

export const IMAGE_RULES: Record<ImagePurpose, ImageRule> = {
  logo: {
    types: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    maxBytes: 5 * MB,
    help: 'PNG, JPG, WebP or SVG, up to 5 MB (SVG up to 1 MB).',
  },
  favicon: {types: ['image/png', 'image/svg+xml'], maxBytes: 1 * MB, help: 'PNG or SVG, up to 1 MB.'},
  image: {types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxBytes: 5 * MB, help: 'PNG, JPG, WebP or GIF, up to 5 MB.'},
  og: {types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * MB, help: 'PNG, JPG or WebP, up to 5 MB.'},
};

/** File extension per accepted image type (the stored file's name). */
export const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export function isImagePurpose(v: unknown): v is ImagePurpose {
  return typeof v === 'string' && (IMAGE_PURPOSES as readonly string[]).includes(v);
}

/** The largest file of `contentType` for `purpose`. */
export function maxBytesFor(purpose: ImagePurpose, contentType: string): number {
  const max = IMAGE_RULES[purpose].maxBytes;
  return contentType === 'image/svg+xml' ? Math.min(max, SVG_MAX_BYTES) : max;
}

/**
 * Why an image can't be uploaded for `purpose`, or null when it can. Used by the browser before
 * the upload starts AND by the route before `createUpload()`: the same rule, the same message.
 */
export function checkImage(file: {type: string; size: number}, purpose: ImagePurpose): string | null {
  const rule = IMAGE_RULES[purpose];
  if (!rule.types.includes(file.type)) return `That file type isn’t supported. ${rule.help}`;
  if (!Number.isFinite(file.size) || file.size < 1) return 'That file is empty.';
  if (file.size > maxBytesFor(purpose, file.type)) return `That file is too large. ${rule.help}`;
  return null;
}

/** The stored name of an image: `<purpose>.<ext>`. The file id keeps it unique. */
export function imageFileName(purpose: ImagePurpose, contentType: string): string {
  return `${purpose}.${IMAGE_EXT[contentType] ?? 'bin'}`;
}

const IMAGE_NAME = /^(logo|favicon|image|og)\.(png|jpg|webp|gif|svg)$/;

/** The purpose a stored image name was created for, or null for any other file. */
export function purposeOfImageName(name: string): ImagePurpose | null {
  const m = IMAGE_NAME.exec(name);
  return m ? (m[1] as ImagePurpose) : null;
}

// ------------------------------------------------------------------ signatures

/**
 * One drawn signature. A 2× DPR signature canvas exported by the browser is 10–60 KB; the old
 * app allowed ~300 KB of PNG per signature (a 400 000-character data URL) and 1 MB per submit.
 */
export const SIGNATURE_MAX_BYTES = 300 * 1024;
export const SIGNATURE_TYPE = 'image/png';
export const SIGNATURE_NAME = 'signature.png';
/** All signatures of one submit together. */
export const SIGNATURES_PER_SUBMIT_MAX_BYTES = 1 * MB;

/** How long an upload token stays valid: the platform drops a file not completed after ~1 hour. */
export const SIGNATURE_TOKEN_TTL_SECONDS = 60 * 60;

/** Rate limits for anonymous signature uploads (per caller address block). */
export const SIGNATURE_RATE = {
  /** Per caller and form. */
  perForm: {limit: 20, windowSeconds: 10 * 60},
  /** Per caller, all forms. */
  perCaller: {limit: 60, windowSeconds: 60 * 60},
} as const;

/** Rate limit for editors' image uploads (per user). The old app: 60 per 10 minutes. */
export const IMAGE_RATE = {limit: 60, windowSeconds: 10 * 60} as const;

export function checkSignature(file: {type: string; size: number}): string | null {
  if (file.type !== SIGNATURE_TYPE) return 'A signature must be a PNG image.';
  if (!Number.isFinite(file.size) || file.size < 1) return 'The signature is empty. Sign again.';
  if (file.size > SIGNATURE_MAX_BYTES) return 'Your signature is too large to save. Clear it and sign again.';
  return null;
}

/** A platform file id (`file_` + 26 lowercase base-36 characters). */
export const FILE_ID = /^file_[0-9a-z]{26}$/;

export const isFileId = (v: unknown): v is string => typeof v === 'string' && FILE_ID.test(v);

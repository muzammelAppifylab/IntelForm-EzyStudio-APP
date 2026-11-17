import fs from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

/**
 * Dead code guard (audit F-047). The migration left copies of live modules that only tests
 * imported (a PNG validator, a CSV writer, a webhook SSRF check, the summary-card registry), so a
 * fix made in the tested copy went green while production kept running the other one.
 *
 * 1. Every app source file under src/ must be imported by another source file (tests don't
 *    count) or be an entry point. A file only tests import is dead code with false coverage.
 * 2. Every package.json dependency must be imported somewhere in the app.
 */

const root = path.resolve(__dirname, '../..');
const EXTS = ['.ts', '.tsx', '.astro', '.mjs', '.js'];

/** Entry points: loaded by Astro, Vite or the template by path, not imported. */
const ENTRY = [
  /^src\/pages\//,
  /^src\/platform\//, // template-owned (docs/agent/upgrade.md): checked by the template's own tooling
  /^src\/middleware\.ts$/,
  /^src\/content\.config\.ts$/,
  /^src\/env\.d\.ts$/,
];

/**
 * Template scaffolding IntelForm doesn't use. They ship with the template (v0.10.24) and are kept
 * so template upgrades apply cleanly; never add an app file here, delete it instead.
 */
const TEMPLATE_SCAFFOLDING = new Set([
  'src/components/home/HeroVisual.astro',
  'src/components/NoAccess.astro',
  'src/components/payments/PriceList.astro',
  'src/components/video/VideoPlayer.tsx',
  'src/portal/video/VideoUpload.tsx',
  'src/server/memberships.ts',
]);

/** Dependencies the app needs without importing them by name (each with its reason). */
const INDIRECT_DEPENDENCIES = new Set<string>([
  '@prisma/client', // the generated client (src/generated/prisma) imports its runtime
  '@prisma/adapter-ppg', // forked into src/platform/db-socket-conversion.ts; pinned with it
  '@videojs/hlsjs-video', // loaded by @videojs/react/media/hlsjs-video (the platform's player)
  '@videojs/vimeo-video', // loaded by @videojs/react/media/vimeo-video
  '@videojs/youtube-video', // loaded by @videojs/react/media/youtube-video
]);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'generated' || e.name === 'node_modules' ? [] : walk(p);
    return [p];
  });
}

const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');
const IMPORT_RE = /(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|import\.meta\.glob[^(]*\(\s*['"]\/node_modules\/((?:@[^/'"]+\/)?[^/'"]+)/g;

function specifiers(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT_RE)].map(m => (m[1] ?? m[2] ?? m[3] ?? m[4])!);
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec.replace(/\?.*$/, ''));
  const candidates = [
    base,
    ...EXTS.map(e => base + e),
    ...EXTS.map(e => path.join(base, 'index' + e)),
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
  ];
  return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

const srcFiles = walk(path.join(root, 'src')).filter(f => EXTS.includes(path.extname(f)));
// Root config files (astro.config.mjs, vitest.config.ts, prisma.config.ts…) can load src files too.
const rootConfigs = fs
  .readdirSync(root, {withFileTypes: true})
  .filter(e => e.isFile() && EXTS.includes(path.extname(e.name)))
  .map(e => path.join(root, e.name));
const appFiles = [...srcFiles, ...rootConfigs, ...walk(path.join(root, 'scripts')).filter(f => EXTS.includes(path.extname(f)))];

describe('no dead code (F-047)', () => {
  it('every src file is imported by app code, not only by tests', () => {
    const referenced = new Set<string>();
    for (const f of appFiles) {
      for (const spec of specifiers(f)) {
        const target = resolveLocal(f, spec);
        if (target && target !== f) referenced.add(rel(target));
      }
    }
    const dead = srcFiles
      .map(rel)
      .filter(f => !ENTRY.some(re => re.test(f)) && !TEMPLATE_SCAFFOLDING.has(f) && !referenced.has(f));
    expect(dead, 'delete these files (or import them from app code); point tests at the live module').toEqual([]);
  });

  it('the template scaffolding allowlist only names files that exist', () => {
    for (const f of TEMPLATE_SCAFFOLDING) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });

  it('every dependency is imported by the app', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {dependencies: Record<string, string>};
    const used = new Set<string>();
    for (const f of appFiles) {
      for (const spec of specifiers(f)) {
        if (spec.startsWith('.') || spec.startsWith('node:')) continue;
        const parts = spec.split('/');
        used.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!);
      }
    }
    const unused = Object.keys(pkg.dependencies).filter(d => !used.has(d) && !INDIRECT_DEPENDENCIES.has(d));
    expect(unused, 'remove these from package.json (npm rm) or import them').toEqual([]);
  });
});

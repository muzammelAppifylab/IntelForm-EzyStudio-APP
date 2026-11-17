import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, describe, expect, it, vi} from 'vitest';

import {
  checkDevDatabase,
  databaseLabel,
  devDatabaseReport,
  devDatabaseTargets,
  sameDatabase,
} from '../../src/lib/dev-database-target';

/**
 * F-032: `DATABASE_URL=…/other npx astro dev` used the `.env` database while the Prisma CLI and
 * dev-admin honoured the shell, silently. Both now name their database at start and warn on a
 * mismatch, without ever printing a user name or password.
 */
const ENV_URL = 'postgresql://postgres:s3cret-env@localhost:5432/site';
const OTHER_URL = 'postgresql://postgres:s3cret-shell@localhost:5432/throwaway';

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dev-db-target-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

describe('databaseLabel', () => {
  it('names the database, host and port, never the credentials', () => {
    const label = databaseLabel(ENV_URL);
    expect(label).toBe('"site" on localhost:5432');
    expect(label).not.toContain('s3cret');
    expect(label).not.toContain('postgres');
  });
  it('handles empty and broken values', () => {
    expect(databaseLabel('')).toMatch(/empty/);
    expect(databaseLabel('not a url')).toMatch(/not a URL/);
  });
});

describe('sameDatabase', () => {
  it('ignores the password and query options, not the name, host or port', () => {
    expect(sameDatabase(ENV_URL, 'postgresql://postgres:other@LOCALHOST:5432/site?sslmode=disable')).toBe(true);
    expect(sameDatabase(ENV_URL, OTHER_URL)).toBe(false);
    expect(sameDatabase(ENV_URL, 'postgresql://postgres:x@localhost:5433/site')).toBe(false);
  });
});

describe('devDatabaseTargets', () => {
  it('no shell DATABASE_URL: both use .env, no warning', () => {
    const t = devDatabaseTargets({files: {env: `DATABASE_URL=${ENV_URL}\n`}, shell: {}});
    expect(t).toMatchObject({devServer: {url: ENV_URL, source: '.env'}, cli: {url: ENV_URL, source: '.env'}, mismatch: false});
    expect(devDatabaseReport(t, 'dev-server')).toEqual({level: 'info', lines: ['Dev server database: "site" on localhost:5432 (from .env)']});
  });

  it('a shell DATABASE_URL pointing elsewhere is a mismatch the dev server ignores', () => {
    const t = devDatabaseTargets({files: {env: `DATABASE_URL=${ENV_URL}\n`}, shell: {DATABASE_URL: OTHER_URL}});
    expect(t.devServer).toEqual({url: ENV_URL, source: '.env'});
    expect(t.cli).toEqual({url: OTHER_URL, source: 'the shell'});
    expect(t.mismatch).toBe(true);
    const report = devDatabaseReport(t, 'dev-server');
    expect(report.level).toBe('warn');
    const text = report.lines.join('\n');
    expect(text).toContain('DATABASE MISMATCH');
    expect(text).toContain('"site" on localhost:5432 (from .env)');
    expect(text).toContain('"throwaway" on localhost:5432 (from the shell)');
    expect(text).not.toContain('s3cret');
  });

  it('the same database in the shell and .env is not a mismatch', () => {
    expect(devDatabaseTargets({files: {env: `DATABASE_URL=${ENV_URL}`}, shell: {DATABASE_URL: ENV_URL}}).mismatch).toBe(false);
  });

  it('.dev.vars wins over .env and .env.local for the dev server, as in workerd', () => {
    const files = {devVars: `DATABASE_URL=${OTHER_URL}`, env: `DATABASE_URL=${ENV_URL}`, envLocal: `DATABASE_URL=${ENV_URL}`};
    expect(devDatabaseTargets({files, shell: {}}).devServer).toEqual({url: OTHER_URL, source: '.dev.vars'});
    expect(devDatabaseTargets({files: {env: `DATABASE_URL=${ENV_URL}`, envLocal: `DATABASE_URL=${OTHER_URL}`}, shell: {}}).devServer.source).toBe('.env.local');
  });

  it('CLOUDFLARE_INCLUDE_PROCESS_ENV makes the dev server honour the shell too', () => {
    const t = devDatabaseTargets({files: {env: `DATABASE_URL=${ENV_URL}`}, shell: {DATABASE_URL: OTHER_URL, CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true'}});
    expect(t.devServer.url).toBe(OTHER_URL);
    expect(t.mismatch).toBe(false);
  });

  it('only "true" turns CLOUDFLARE_INCLUDE_PROCESS_ENV on, as in wrangler', () => {
    const t = devDatabaseTargets({files: {env: `DATABASE_URL=${ENV_URL}`}, shell: {DATABASE_URL: OTHER_URL, CLOUDFLARE_INCLUDE_PROCESS_ENV: '1'}});
    expect(t.devServer.source).toBe('.env');
    expect(t.mismatch).toBe(true);
  });

  it('CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false leaves the dev server with no database, even with the shell included', () => {
    const t = devDatabaseTargets({
      files: {env: `DATABASE_URL=${ENV_URL}`},
      shell: {CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true', DATABASE_URL: ENV_URL},
    });
    expect(t.devServer.url).toBe('');
    expect(t.mismatch).toBe(true);
    expect(devDatabaseReport(t, 'prisma').lines.join('\n')).toContain('(none: DATABASE_URL is empty) (from nothing (CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false))');
  });
});

describe('checkDevDatabase', () => {
  it('says nothing without env files (a Build) or in the editor Preview', () => {
    expect(checkDevDatabase(project({}), {DATABASE_URL: OTHER_URL}, 'prisma')).toBeNull();
    expect(checkDevDatabase(project({'.env': `DATABASE_URL=${ENV_URL}`}), {DATABASE_URL: OTHER_URL, SITE_PREVIEW: '1'}, 'prisma')).toBeNull();
  });
  it('reads the files in the folder', () => {
    const dir = project({'.env': `DATABASE_URL=${ENV_URL}\nJWT_SECRET=x\n`});
    expect(checkDevDatabase(dir, {DATABASE_URL: OTHER_URL}, 'prisma')?.level).toBe('warn');
    expect(checkDevDatabase(dir, {}, 'prisma')?.lines).toEqual(['Prisma database: "site" on localhost:5432 (from .env)']);
  });
});

describe('wired into the dev server (astro.config.mjs)', () => {
  it('warns at `astro dev` start when the shell DATABASE_URL differs from .env', async () => {
    const dir = project({'.env': `DATABASE_URL=${ENV_URL}\n`});
    const before = process.env.DATABASE_URL;
    const cwd = process.cwd();
    process.env.DATABASE_URL = OTHER_URL;
    vi.resetModules();
    try {
      const {default: config} = await import('../../astro.config.mjs');
      const integration = config.integrations?.find((i: {name: string}) => i.name === 'dev-database-target');
      expect(integration).toBeTruthy();
      const logger = {info: vi.fn(), warn: vi.fn()};
      process.chdir(dir);
      integration.hooks['astro:config:setup']({command: 'dev', logger});
      const warned = logger.warn.mock.calls.map((c) => c[0]).join('\n');
      expect(warned).toContain('DATABASE MISMATCH');
      expect(warned).toContain('"site" on localhost:5432 (from .env)');
      expect(warned).not.toContain('s3cret');
      // A build says nothing.
      const buildLogger = {info: vi.fn(), warn: vi.fn()};
      integration.hooks['astro:config:setup']({command: 'build', logger: buildLogger, updateConfig: () => {}});
      expect(buildLogger.warn).not.toHaveBeenCalled();
      expect(buildLogger.info).not.toHaveBeenCalled();
    } finally {
      process.chdir(cwd);
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });
});

describe('wired into the Prisma CLI (prisma.config.ts)', () => {
  it('names the target and warns on a mismatch, with no credentials', async () => {
    const dir = project({'.env': `DATABASE_URL=${ENV_URL}\n`});
    const before = process.env.DATABASE_URL;
    const cwd = process.cwd();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.DATABASE_URL = OTHER_URL;
    process.chdir(dir);
    vi.resetModules();
    try {
      await import('../../prisma.config');
      const out = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(out).toContain('DATABASE MISMATCH');
      expect(out).toContain('"throwaway" on localhost:5432 (from the shell)');
      expect(out).toContain('"site" on localhost:5432 (from .env)');
      expect(out).not.toContain('s3cret');
    } finally {
      warn.mockRestore();
      process.chdir(cwd);
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });
});

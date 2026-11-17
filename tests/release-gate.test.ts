import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, describe, expect, it} from 'vitest';

import {readAudit, readReport, testDatabaseUrl, testFiles} from '../scripts/check.mjs';

/**
 * The release gate (`npm run check` = scripts/check.mjs). Audit findings F-021 (the gate went
 * green with the integration suite skipped), F-048 (a crashed test worker dropped a whole file
 * while the summary listed only passes), F-024 (npm audit in the gate) and F-054 (a linter).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'gate-test-'));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

describe('npm run check', () => {
  it('is the gate script, which runs lint, npm audit, the tests and the build', () => {
    expect(pkg.scripts.check).toBe('node scripts/check.mjs');
    const src = readFileSync(join(ROOT, 'scripts/check.mjs'), 'utf8');
    for (const step of ["'run', 'lint'", "'audit', '--omit=dev'", "['test'", "'run', 'build'"]) expect(src).toContain(step);
  });

  it('stops, non-zero and in words, when there is no TEST_DATABASE_URL', () => {
    const envFile = join(scratch, 'no-db.env');
    writeFileSync(envFile, 'DATABASE_URL=postgresql://example.invalid/db\n');
    const env = {...process.env, TEST_DATABASE_URL: '', CHECK_ENV_FILE: envFile};
    const run = spawnSync(process.execPath, [join(ROOT, 'scripts/check.mjs')], {cwd: scratch, env, encoding: 'utf8'});
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('npm run check needs TEST_DATABASE_URL');
    expect(run.stderr).toContain('SKIPPED');
  });
});

describe('coverage (F-048)', () => {
  it('runs in worker threads, and the gate fails when a test file is missing from the report', () => {
    expect(pkg.scripts['test:coverage']).toBe('prisma generate && vitest run --coverage --pool=threads');
    expect(readFileSync(join(ROOT, 'scripts/check.mjs'), 'utf8')).toContain("failures.push('tests (files missing from the report)')");
  });
});

describe('testDatabaseUrl', () => {
  it('prefers the shell, then .env, and takes nothing else from .env', () => {
    const envFile = join(scratch, 'with-db.env');
    writeFileSync(envFile, 'JWT_SECRET=x\nTEST_DATABASE_URL=postgresql://localhost/from_file\n');
    expect(testDatabaseUrl({TEST_DATABASE_URL: 'postgresql://localhost/from_shell'}, envFile)).toEqual({
      url: 'postgresql://localhost/from_shell',
      source: 'shell',
    });
    expect(testDatabaseUrl({}, envFile)).toEqual({url: 'postgresql://localhost/from_file', source: '.env'});
    expect(testDatabaseUrl({}, join(scratch, 'missing.env'))).toEqual({url: '', source: null});
    expect(testDatabaseUrl({TEST_DATABASE_URL: '  '}, join(scratch, 'missing.env')).url).toBe('');
  });
});

describe('readReport', () => {
  const file = (name: string, ...statuses: string[]) => ({
    name: join(ROOT, name),
    assertionResults: statuses.map((status, i) => ({status, fullName: 't' + i})),
  });

  it('names a test file that never reported (a crashed worker)', () => {
    const report = {success: true, numPassedTests: 2, testResults: [file('tests/a.test.ts', 'passed')]};
    const r = readReport(report, ['tests/a.test.ts', 'tests/intelform/builder-api.test.ts'], ROOT);
    expect(r.missingFiles).toEqual(['tests/intelform/builder-api.test.ts']);
  });

  it('names skipped integration tests, not opt-in unit skips', () => {
    const report = {
      success: true,
      testResults: [file('tests/integration/auth.test.ts', 'passed', 'skipped'), file('tests/intelform/x.test.ts', 'skipped')],
    };
    const r = readReport(report, ['tests/integration/auth.test.ts', 'tests/intelform/x.test.ts'], ROOT);
    expect(r.integrationSkipped).toEqual(['tests/integration/auth.test.ts > t1']);
    expect(r.missingFiles).toEqual([]);
  });

  it('expects every *.test.ts under tests/, this file included', () => {
    const files = testFiles(ROOT);
    expect(files).toContain('tests/release-gate.test.ts');
    expect(files.some((f: string) => f.startsWith('tests/integration/'))).toBe(true);
  });
});

describe('readAudit', () => {
  it('counts moderate and worse, and says when the audit could not run', () => {
    const clean = {metadata: {vulnerabilities: {low: 1, moderate: 0, high: 0, critical: 0}}, vulnerabilities: {}};
    expect(readAudit(JSON.stringify(clean))).toEqual({total: 0, low: 1, names: []});
    const bad = {metadata: {vulnerabilities: {moderate: 1, high: 1}}, vulnerabilities: {hono: {}, astro: {}}};
    expect(readAudit(JSON.stringify(bad))).toEqual({total: 2, low: 0, names: ['hono', 'astro']});
    expect(readAudit(JSON.stringify({error: {code: 'ENOTFOUND'}}))).toBeNull();
    expect(readAudit('')).toBeNull();
  });
});

describe('lint (F-054)', () => {
  it('is a script that fails on warnings, and the code is clean', () => {
    expect(pkg.scripts.lint).toContain('oxlint -c oxlint.json --deny-warnings');
    const args = pkg.scripts.lint.split(' ').slice(1);
    const bin = join(ROOT, 'node_modules/oxlint/bin/oxlint');
    const run = spawnSync(process.execPath, [bin, ...args], {cwd: ROOT, encoding: 'utf8'});
    expect(run.stdout + run.stderr).not.toMatch(/warning|error\b.*\(/);
    expect(run.status).toBe(0);
  }, 60_000);
});

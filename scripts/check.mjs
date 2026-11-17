// The release gate: `npm run check`. Lint, known security problems in the production
// packages, every test (the integration suite included) and the production build.
//
//   npm run check                       # needs TEST_DATABASE_URL (shell or .env)
//   npm run check -- --allow-no-db      # unit tests only, with a loud warning (never before a release)
//
// The integration tests (tests/integration/*: sign-in, permissions, submit, delete, erase,
// export) skip themselves without TEST_DATABASE_URL, so a gate that only ran `npm test` went
// green with all of them skipped. This one stops instead, and after the tests it checks the
// vitest report: every test file ran (a crashed worker drops a file silently) and no
// integration test was skipped.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * TEST_DATABASE_URL from the shell, else from `.env` (the file the dev server reads too).
 * Only that one name is taken from `.env`. Returns where it came from, never prints it.
 */
export function testDatabaseUrl(env = process.env, envFile = env.CHECK_ENV_FILE || join(ROOT, '.env')) {
  const fromShell = env.TEST_DATABASE_URL?.trim();
  if (fromShell) return {url: fromShell, source: 'shell'};
  if (envFile && existsSync(envFile)) {
    const fromFile = parseEnv(readFileSync(envFile, 'utf8')).TEST_DATABASE_URL?.trim();
    if (fromFile) return {url: fromFile, source: '.env'};
  }
  return {url: '', source: null};
}

/** Every `*.test.ts` under tests/, as vitest's `include` (`tests/**\/*.test.ts`) finds them. */
export function testFiles(root = ROOT) {
  const out = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(path);
      } else if (entry.name.endsWith('.test.ts')) out.push(relative(root, path).split(sep).join('/'));
    }
  };
  visit(join(root, 'tests'));
  return out.sort();
}

/**
 * What a vitest JSON report says about the gate: test files that never reported (a worker
 * crashed), integration tests that were skipped, and the totals.
 */
export function readReport(report, expectedFiles, root = ROOT) {
  const ran = new Set();
  const integrationSkipped = [];
  for (const file of report.testResults ?? []) {
    const rel = relative(root, file.name).split(sep).join('/');
    ran.add(rel);
    if (!rel.startsWith('tests/integration/')) continue;
    for (const test of file.assertionResults ?? [])
      if (test.status !== 'passed' && test.status !== 'failed') integrationSkipped.push(rel + ' > ' + test.fullName);
  }
  return {
    missingFiles: expectedFiles.filter(f => !ran.has(f)),
    integrationSkipped,
    totals: {
      files: ran.size,
      passed: report.numPassedTests ?? 0,
      failed: report.numFailedTests ?? 0,
      skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    },
    success: report.success === true,
  };
}

/**
 * Advisories from `npm audit --json`. `null` when the audit itself could not run (no network):
 * the caller says so in words, never as a pass.
 */
export function readAudit(stdout) {
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (json.error || !json.metadata) return null;
  const v = json.metadata.vulnerabilities ?? {};
  return {
    total: (v.moderate ?? 0) + (v.high ?? 0) + (v.critical ?? 0),
    low: v.low ?? 0,
    names: Object.keys(json.vulnerabilities ?? {}),
  };
}

function banner(lines) {
  const width = Math.max(...lines.map(l => l.length)) + 4;
  const bar = '!'.repeat(width);
  return ['', bar, ...lines.map(l => '! ' + l.padEnd(width - 4) + ' !'), bar, ''].join('\n');
}

/**
 * Runs an npm script or command. `npm_execpath` (set by `npm run`) is npm's own CLI file: running
 * it with this node works the same on Windows, where `execFileSync('npm')` fails with ENOENT
 * (npm is `npm.cmd` there; store-check.mjs's audit hits that, finding F-052).
 */
function npm(args, options = {}) {
  const cli = process.env.npm_execpath;
  const [cmd, argv, shell] = cli && cli.endsWith('.js')
    ? [process.execPath, [cli, ...args], false]
    : ['npm', args, process.platform === 'win32'];
  return spawnSync(cmd, argv, {cwd: ROOT, stdio: 'inherit', shell, ...options});
}

function step(title) {
  console.log('\n== ' + title + ' ==');
}

function main(argv) {
  const allowNoDb = argv.includes('--allow-no-db');
  const failures = [];

  step('Integration database');
  const db = testDatabaseUrl();
  if (!db.url && !allowNoDb) {
    console.error(banner([
      'npm run check needs TEST_DATABASE_URL: without it the integration tests',
      '(sign-in, permissions, submit, delete, erase, export) are SKIPPED and the gate means little.',
      'Set it in .env or the shell to a THROWAWAY database (the tests empty it), migrated with',
      '  DATABASE_URL=<that url> npx prisma migrate deploy',
      'README.md "Tests" has the steps. Unit tests only (never before a release):',
      '  npm run check -- --allow-no-db',
    ]));
    process.exit(1);
  }
  if (!db.url)
    console.warn(banner(['NO TEST_DATABASE_URL: the integration tests will be SKIPPED.', 'This run is not a release gate.']));
  else console.log('TEST_DATABASE_URL from ' + (db.source === 'shell' ? 'the shell' : '.env') + ' (a throwaway database: the tests empty it).');

  step('Lint');
  if (npm(['run', 'lint']).status !== 0) failures.push('lint');

  step('Known security problems in the production packages (npm audit --omit=dev)');
  const audit = npm(['audit', '--omit=dev', '--package-lock-only', '--json'], {stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'});
  const advisories = readAudit(audit.stdout ?? '');
  if (!advisories)
    console.warn(banner(['npm audit could not run here (offline?). Run `npm audit --omit=dev` before you push:', 'the store runs it on every submit.']));
  else if (advisories.total) {
    console.error('npm audit: ' + advisories.total + ' moderate or worse in production packages: ' + advisories.names.join(', '));
    console.error('Fix within the declared ranges (`npm audit fix`, never --force), then run this again.');
    failures.push('npm audit');
  } else console.log('npm audit: no moderate, high or critical advisories' + (advisories.low ? ' (' + advisories.low + ' low)' : '') + '.');

  step('Tests');
  const dir = mkdtempSync(join(tmpdir(), 'site-check-'));
  const out = join(dir, 'vitest.json');
  try {
    const env = {...process.env};
    if (db.url) env.TEST_DATABASE_URL = db.url;
    const test = npm(['test', '--', '--reporter=default', '--reporter=json', '--outputFile.json=' + out], {env});
    if (!existsSync(out)) failures.push('tests (no report: the run crashed)');
    else {
      const r = readReport(JSON.parse(readFileSync(out, 'utf8')), testFiles());
      console.log(banner([
        'Test files: ' + r.totals.files + ' ran of ' + testFiles().length + '. Tests: ' + r.totals.passed + ' passed, ' +
          r.totals.failed + ' failed, ' + r.totals.skipped + ' skipped.',
        db.url ? 'Integration suite: ' + (r.integrationSkipped.length ? r.integrationSkipped.length + ' SKIPPED' : 'ran') : 'Integration suite: SKIPPED (no TEST_DATABASE_URL)',
      ]));
      if (r.missingFiles.length) {
        console.error('These test files never reported (a test worker crashed?):\n  ' + r.missingFiles.join('\n  '));
        failures.push('tests (files missing from the report)');
      }
      if (db.url && r.integrationSkipped.length) {
        console.error('Integration tests skipped although TEST_DATABASE_URL is set:\n  ' + r.integrationSkipped.slice(0, 20).join('\n  '));
        failures.push('tests (integration skipped)');
      }
      if (test.status !== 0 || !r.success) failures.push('tests');
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }

  step('Production build');
  if (npm(['run', 'build']).status !== 0) failures.push('build');

  if (failures.length) {
    console.error(banner(['npm run check FAILED: ' + failures.join(', ')]));
    process.exit(1);
  }
  if (!db.url) {
    console.warn(banner(['Passed WITHOUT the integration tests (--allow-no-db). Not a release gate.']));
    return;
  }
  console.log('\nnpm run check passed: lint, npm audit, every test (integration included), build.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));

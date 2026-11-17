import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

import {defineConfig} from 'vitest/config';

import {devDatabaseUrls, sameDatabase} from './scripts/check.mjs';

/**
 * Unit tests (`tests/*.test.ts`): the auth core's pure modules, no database.
 * Integration tests (`tests/integration/*.test.ts`): the real Hono app against
 * a real Postgres, ONLY when `TEST_DATABASE_URL` is set (skipped otherwise):
 *
 *   TEST_DATABASE_URL=postgresql://…/site_tpl_test npm test
 *
 * or `TEST_DATABASE_URL=…` in `.env` (the dev server reads `.env` too; only that one name is
 * taken from it here). Use a throwaway database: the integration tests empty its tables.
 * `npm run check` (scripts/check.mjs) refuses to run without it.
 */
// Unit tests run without any of this; `npm test` runs `prisma generate` first.
if (!process.env.TEST_DATABASE_URL?.trim() && existsSync('.env')) {
  const fromFile = parseEnv(readFileSync('.env', 'utf8')).TEST_DATABASE_URL?.trim();
  if (fromFile) process.env.TEST_DATABASE_URL = fromFile;
}
// Never the dev database: the integration tests empty every table of TEST_DATABASE_URL.
if (process.env.TEST_DATABASE_URL?.trim() && devDatabaseUrls().some(dev => sameDatabase(dev, process.env.TEST_DATABASE_URL)))
  throw new Error(
    'TEST_DATABASE_URL names the same database as DATABASE_URL (shell or .env). The integration tests EMPTY it: ' +
      'point TEST_DATABASE_URL at a separate, throwaway database.',
  );
if (!process.env.TEST_DATABASE_URL?.trim())
  console.warn(
    '\n!!! No TEST_DATABASE_URL: the integration tests (tests/integration/*) are SKIPPED. ' +
      'Set it in .env or the shell (a throwaway database) before trusting a green run.\n',
  );

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'cloudflare:workers',
        replacement: fileURLToPath(new URL('./tests/integration/support/cloudflare-workers.ts', import.meta.url)),
      },
      // The site's client is built for workerd (it imports wasm as a module);
      // tests use the Node build of the same schema (`generator nodeClient`).
      {
        find: /^(?:\.\.\/)+generated\/prisma\/client$/,
        replacement: fileURLToPath(new URL('./src/generated/prisma-node/client.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The integration files share one database: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    // `npm run test:coverage` (v8). It runs with `--pool=threads`: under coverage a forked
    // worker sometimes exited mid-file on Windows ("Worker exited unexpectedly") and that
    // file's tests silently vanished from the summary (audit F-048); worker threads hand the
    // coverage back over a MessagePort instead of the child-process pipe. That is NOT a cure:
    // on a loaded Windows machine a threads run can still die mid-suite (exit 127, no summary),
    // which at least fails loudly instead of listing only passes. The cause is not known yet.
    // `npm run check` fails when any test file is missing from the report.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/generated/**'],
      reporter: ['text-summary', 'html'],
      reportOnFailure: true,
    },
  },
});

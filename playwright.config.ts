import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against the built production server (`npm run build` first).
 *
 * - The web server is `npm start` on E2E_PORT (default 8793) against E2E_DATABASE_URL (default
 *   intelform_c_e2e), which server/test/e2e-global-setup.ts drops and recreates before every run, so
 *   the first spec starts on a fresh install. MIGRATE_ON_BOOT applies the schema. One database per run.
 * - Projects, in order:
 *   1. `platform` performs first-run setup through the UI (its Owner is OWNER in e2e/helpers/auth.ts);
 *   2. `auth` (e2e/helpers/auth.setup.ts) signs that Owner in once and saves the session to
 *      test-results/.auth/owner.json; specs reuse it with `test.use({ storageState: OWNER_STATE })`;
 *   3. `app`: every other spec.
 * - Browser: Playwright's cached chromium, or E2E_CHANNEL=chrome for the local Chrome.
 * - Set E2E_BASE_URL to test an already-running server instead (no web server is started).
 * - Chromium only, one worker. Retries: 0 locally, 1 in CI. Trace, video and screenshot kept only for failures.
 */
const PORT = Number(process.env.E2E_PORT ?? 8793)
const external = !!process.env.E2E_BASE_URL
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgres://intelform:intelform@localhost:5433/intelform_c_e2e'

const browser = { ...devices['Desktop Chrome'], ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}) }

export default defineConfig({
  testDir: './e2e',
  // E2E_OUTPUT_DIR lets parallel local runs keep their artifacts apart.
  outputDir: process.env.E2E_OUTPUT_DIR ?? './test-results/e2e',
  fullyParallel: false,
  // One server and one database: specs share the Owner and the rate-limit counters.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'test-results/e2e-report' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure', video: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'platform', testMatch: /platform\.spec\.ts$/, use: browser },
    { name: 'auth', testMatch: /helpers\/auth\.setup\.ts$/, dependencies: ['platform'], use: browser },
    { name: 'app', testIgnore: /platform\.spec\.ts$/, dependencies: ['auth'], use: browser },
  ],
  webServer: external
    ? undefined
    : {
        // Playwright starts web servers before globalSetup, so the database reset runs here.
        command: 'npx tsx server/test/e2e-global-setup.ts && npm start',
        url: `${baseURL}/api/ready`,
        reuseExistingServer: !process.env.CI,
        timeout: 90_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          DATABASE_URL: E2E_DATABASE_URL,
          E2E_DATABASE_URL,
          APP_URL: baseURL,
          API_PORT: String(PORT),
          APP_SECRET: process.env.APP_SECRET ?? 'e2e-secret-0123456789abcdef0123456789abcdef',
          EMAIL_DRIVER: 'console',
          MIGRATE_ON_BOOT: '1',
          LOG_LEVEL: 'warn',
        },
      },
})

/**
 * Test environment. Import this FIRST in every server test file (before anything that reads
 * server/env.ts), or use `setupTestDb()` from ./harness which imports it for you.
 */
process.env.NODE_ENV = 'test'
process.env.APP_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef'
process.env.APP_URL = process.env.TEST_APP_URL ?? 'http://localhost:5183'
process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL || 'postgres://intelform:intelform@localhost:5433/intelform_c'
process.env.EMAIL_DRIVER = ''
process.env.TRUSTED_PROXY_HOPS = '0'
process.env.LOG_LEVEL ||= 'silent'
delete process.env.BUNNY_STORAGE_ZONE
delete process.env.BUNNY_STORAGE_KEY
delete process.env.BUNNY_CDN_URL

export const TEST_ORIGIN = new URL(process.env.APP_URL).origin

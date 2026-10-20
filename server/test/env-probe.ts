/**
 * Run in a child process by hardening.int.test.ts (A8): prints how the cookie and HSTS are
 * configured for the APP_URL / NODE_ENV it was started with. Never connects to the database.
 */
const { isHttps, appOrigin } = await import('../env')
const { SESSION_COOKIE } = await import('../lib/session')
const { securityHeaders } = await import('../middleware/security-headers')

console.log(
  JSON.stringify({
    isHttps,
    appOrigin,
    cookie: SESSION_COOKIE,
    hsts: securityHeaders('dashboard')['Strict-Transport-Security'] ?? null,
  }),
)
process.exit(0)

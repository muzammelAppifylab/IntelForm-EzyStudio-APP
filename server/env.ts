import { z } from 'zod'

/** Environment variables, validated once at startup. See .env.example for what each one does. */
const flag = z
  .enum(['0', '1', 'true', 'false', ''])
  .optional()
  .transform((v) => v === '1' || v === 'true')

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
    /** The previous APP_SECRET while rotating: stored secrets encrypted with it still decrypt. */
    APP_SECRET_PREVIOUS: optionalText.pipe(z.string().min(32, 'APP_SECRET_PREVIOUS must be at least 32 characters').optional()),
    APP_URL: z.url().optional(),
    API_PORT: z.coerce.number().int().default(8787),
    /** How many reverse proxies sit in front of the app. 0 = use the socket address, ignore X-Forwarded-For. */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    /** Header a trusted proxy sets with the visitor's two-letter country (Cloudflare: CF-IPCountry). */
    COUNTRY_HEADER: optionalText,
    /** Development override for email. Unset in production: the Owner sets the provider in Settings. */
    EMAIL_DRIVER: z.enum(['none', 'console', '']).optional().transform((v) => v || undefined),
    BUNNY_STORAGE_ZONE: optionalText,
    BUNNY_STORAGE_KEY: optionalText,
    /** Storage region prefix such as "ny", "la", "sg", "uk". Empty = the main Falkenstein region. */
    BUNNY_STORAGE_REGION: optionalText,
    BUNNY_CDN_URL: optionalText.pipe(z.url().optional()),
    /** Local upload folder, used when Bunny is not configured. */
    UPLOADS_DIR: z.string().optional().transform((v) => v || './uploads'),
    /** Development only: lets webhooks reach localhost and private networks. */
    ALLOW_PRIVATE_WEBHOOKS: flag,
    /** Apply pending migrations before the server starts listening. */
    MIGRATE_ON_BOOT: flag,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent', '']).optional().transform((v) => v || undefined),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && !v.APP_URL) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL is required in production (the public https URL of the site)' })
    }
    if (v.NODE_ENV === 'production' && v.ALLOW_PRIVATE_WEBHOOKS) {
      ctx.addIssue({ code: 'custom', path: ['ALLOW_PRIVATE_WEBHOOKS'], message: 'ALLOW_PRIVATE_WEBHOOKS is for development only' })
    }
  })
  .transform((v) => ({ ...v, APP_URL: (v.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '') }))

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment:\n' + z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
/** Cookies get the Secure flag (and the __Host- prefix) whenever the public URL is https. */
export const isHttps = env.APP_URL.startsWith('https://')
export const appOrigin = new URL(env.APP_URL).origin

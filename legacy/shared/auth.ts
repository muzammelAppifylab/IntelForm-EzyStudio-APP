import { z } from 'zod'
import { INVITABLE_ROLES } from './roles'
import { imageUrl, isSingleLine } from './settings-app'

/** Request bodies for setup, auth, profile and team routes. Shared so the browser shows the same errors the server returns. */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address')
  .pipe(z.email('Enter an email address like name@example.com'))

const name = z.string().trim().min(1, 'Enter a name').max(120, 'Use 120 characters or fewer').refine(isSingleLine, 'Use one line of text')

/**
 * The most common passwords of 8+ characters (shorter ones fail the length rule anyway),
 * from public breach top lists. Compared case-insensitively.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'password!', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pass1234',
  'passpass', '12345678', '123456789', '1234567890', '0123456789', '87654321', '987654321', '11111111', '00000000', '22222222',
  '55555555', '66666666', '88888888', '99999999', '12121212', '11223344', '12341234', '12344321', '123123123', '147258369',
  '123456789a', 'a1234567', 'aa123456', 'abc12345', 'abcd1234', 'abcdefgh', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwertyui',
  'qwertyuiop', 'qwer1234', '1234qwer', 'q1w2e3r4', 'q1w2e3r4t5', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', '123qweasd',
  'qweasdzxc', 'asdfghjk', 'asdfghjkl', 'asdfasdf', 'zxcvbnm1', 'iloveyou', 'iloveyou1', 'lovelove', 'sunshine', 'princess',
  'football', 'baseball', 'basketball', 'superman', 'starwars', 'whatever', 'computer', 'internet', 'michelle', 'jennifer',
  'babygirl', 'butterfly', 'chocolate', 'liverpool', 'chelsea1', 'arsenal1', 'pokemon1', 'minecraft', 'jordan23', 'michael1',
  'charlie1', 'freedom1', 'trustno1', 'letmein1', 'letmein123', 'welcome1', 'welcome123', 'admin123', 'administrator', 'changeme',
  'secret123', 'test1234', 'testtest', 'default1', 'hello123', 'goodluck', 'monkey123', 'dragon123', 'master123', 'shadow123',
  'google123', 'facebook', 'samsung1', 'intelform', 'intelform1', 'intelform123',
])

export const COMMON_PASSWORD_MESSAGE = 'This password is too common and easy to guess. Add a few more words or characters.'
export const EMAIL_PASSWORD_MESSAGE = 'Don’t use your email address as your password. Pick something harder to guess.'

/** True when the password is the email address or the part before the @, ignoring case. */
export function passwordMatchesEmail(password: string, email: string): boolean {
  const p = password.trim().toLowerCase()
  const e = email.trim().toLowerCase()
  if (!p || !e) return false
  const local = e.split('@')[0]
  return p === e || (local !== '' && p === local)
}

/** A new account password: 8–200 characters and not on the common-password list. */
export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200, 'Use 200 characters or fewer')
  .refine((v) => !COMMON_PASSWORDS.has(v.trim().toLowerCase()), COMMON_PASSWORD_MESSAGE)

export const setupInput = z
  .object({
    name,
    email,
    password,
    appName: z.string().trim().min(1, 'Enter an app name').max(60, 'Use 60 characters or fewer').refine(isSingleLine, 'Use one line of text'),
    /** Required only when the server sets SETUP_TOKEN (GET /api/setup says so). */
    setupToken: z.string().trim().max(500, 'Use 500 characters or fewer').optional(),
  })
  .refine((v) => !passwordMatchesEmail(v.password, v.email), { message: EMAIL_PASSWORD_MESSAGE, path: ['password'] })
export type SetupInput = z.infer<typeof setupInput>

export const loginInput = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
})
export type LoginInput = z.infer<typeof loginInput>

export const forgotInput = z.object({ email })

export const resetInput = z.object({ token: z.string().min(1), password })

export const inviteInput = z.object({ email, role: z.enum(INVITABLE_ROLES) })
export type InviteInput = z.infer<typeof inviteInput>

export const acceptInviteInput = z.object({ name, password })

export const profileInput = z
  .object({
    name: name.optional(),
    email: email.optional(),
    currentPassword: z.string().optional(),
    newPassword: password.optional(),
    /** Uploaded avatar (POST /api/uploads?purpose=avatar); null removes it. */
    avatarUrl: imageUrl.nullable().optional(),
  })
  .refine((v) => !(v.newPassword || v.email) || !!v.currentPassword, {
    message: 'Enter your current password to change your email or password',
    path: ['currentPassword'],
  })
export type ProfileInput = z.infer<typeof profileInput>

export const memberUpdateInput = z
  .object({
    role: z.enum(INVITABLE_ROLES).optional(),
    /** Owner sets a new password for a member while there is no email provider. */
    password: password.optional(),
    /** The Owner's own password, required with `password`. */
    currentPassword: z.string().optional(),
  })
  .refine((v) => v.role || v.password, { message: 'Nothing to change' })
  .refine((v) => !v.password || !!v.currentPassword, { message: 'Enter your password to confirm', path: ['currentPassword'] })

export const transferOwnershipInput = z.object({
  userId: z.uuid(),
  currentPassword: z.string().min(1, 'Enter your password to confirm'),
})

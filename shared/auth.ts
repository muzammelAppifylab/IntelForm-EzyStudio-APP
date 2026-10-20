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

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200, 'Use 200 characters or fewer')

export const setupInput = z.object({
  name,
  email,
  password,
  appName: z.string().trim().min(1, 'Enter an app name').max(60, 'Use 60 characters or fewer').refine(isSingleLine, 'Use one line of text'),
})
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
  })
  .refine((v) => v.role || v.password, { message: 'Nothing to change' })

export const transferOwnershipInput = z.object({
  userId: z.uuid(),
  currentPassword: z.string().min(1, 'Enter your password to confirm'),
})

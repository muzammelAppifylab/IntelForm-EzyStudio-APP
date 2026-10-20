import { describe, expect, it } from 'vitest'
import { memberUpdateInput, password, passwordMatchesEmail, setupInput } from './auth'

describe('account password rules', () => {
  it('refuse short and common passwords, ignoring case', () => {
    expect(password.safeParse('short1').success).toBe(false)
    for (const p of ['password', 'PASSWORD1', '12345678', 'Qwerty123', 'iloveyou']) expect(password.safeParse(p).success, p).toBe(false)
    expect(password.safeParse('correct horse battery').success).toBe(true)
  })

  it('match the email or its local part', () => {
    expect(passwordMatchesEmail('Jane.Doe@Example.com', 'jane.doe@example.com')).toBe(true)
    expect(passwordMatchesEmail('jane.doe', 'jane.doe@example.com')).toBe(true)
    expect(passwordMatchesEmail('jane.doe1', 'jane.doe@example.com')).toBe(false)
  })

  it('setup refuses a password equal to the email', () => {
    const base = { name: 'A', email: 'owner.person@example.com', appName: 'X' }
    expect(setupInput.safeParse({ ...base, password: 'owner.person' }).success).toBe(false)
    expect(setupInput.safeParse({ ...base, password: 'a-good-pass-phrase' }).success).toBe(true)
  })

  it('setting a member’s password needs the Owner’s password', () => {
    expect(memberUpdateInput.safeParse({ password: 'a-good-pass-phrase' }).success).toBe(false)
    expect(memberUpdateInput.safeParse({ password: 'a-good-pass-phrase', currentPassword: 'x' }).success).toBe(true)
    expect(memberUpdateInput.safeParse({ role: 'viewer' }).success).toBe(true)
  })
})

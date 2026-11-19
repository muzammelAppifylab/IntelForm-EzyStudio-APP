import { defaultFormSettings } from '../../../lib/intelform/form/settings'
import { FORM_LIMITS } from '../../../lib/intelform/spam'

/** The parts of forms.settings the response jobs read, read leniently (a stored row never breaks a job). */
export interface NotifySettings {
  notifyOnResponse: boolean
  notifyRecipients: number[]
  confirmationEmail: boolean
  confirmationEmailFieldId: string | null
  confirmationSubject: string
  confirmationBody: string
  /** Confirmation emails per hour for this form (spam protection). */
  confirmPerHour: number
}

export function readNotifySettings(json: unknown): NotifySettings {
  const d = defaultFormSettings()
  const s = (json && typeof json === 'object' && !Array.isArray(json) ? json : {}) as Record<string, unknown>
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb)
  const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb)
  return {
    notifyOnResponse: bool(s.notifyOnResponse, d.notifyOnResponse),
    notifyRecipients: Array.isArray(s.notifyRecipients)
      ? [...new Set(s.notifyRecipients.filter((n): n is number => Number.isSafeInteger(n) && (n as number) > 0))].slice(0, 50)
      : [],
    confirmationEmail: bool(s.confirmationEmail, d.confirmationEmail),
    confirmationEmailFieldId:
      typeof s.confirmationEmailFieldId === 'string' && s.confirmationEmailFieldId ? s.confirmationEmailFieldId.slice(0, 40) : null,
    confirmationSubject: str(s.confirmationSubject, d.confirmationSubject).slice(0, 200),
    confirmationBody: str(s.confirmationBody, d.confirmationBody).slice(0, 10_000),
    confirmPerHour:
      typeof s.confirmPerHour === 'number' && Number.isInteger(s.confirmPerHour) && s.confirmPerHour >= FORM_LIMITS.confirmPerHour.min && s.confirmPerHour <= FORM_LIMITS.confirmPerHour.max
        ? s.confirmPerHour
        : d.confirmPerHour,
  }
}

import freeDomains from 'free-email-domains'
import { isValidPhoneNumber } from 'libphonenumber-js/max'
import { configureValidators } from '../../shared/form/types/registry'

/**
 * Server-only answer checks (docs/contracts/form-core.md): strict phone metadata and the
 * free-email-domain list. Imported once by the respondent routes; idempotent.
 */
const free = new Set<string>(freeDomains as string[])

configureValidators({
  phone: (e164) => isValidPhoneNumber(e164),
  isFreeEmailDomain: (domain) => free.has(domain),
})

export const validatorsConfigured = true

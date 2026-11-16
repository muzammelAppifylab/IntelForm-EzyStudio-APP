import freeDomains from 'free-email-domains';
import {isValidPhoneNumber} from 'libphonenumber-js/max';

import {configureValidators} from '../../../lib/intelform/form/types/registry';

/**
 * Server-only answer checks for the field types (src/lib/intelform/form/types): strict phone
 * metadata ("max", too big for the browser bundle) and the free-email-domain list ("business
 * email only"). Every other type's check is its registry schema, run by validateSubmission.
 * Imported once by the respondent routes; idempotent.
 */
const free = new Set<string>(freeDomains as string[]);

configureValidators({
  phone: e164 => isValidPhoneNumber(e164),
  isFreeEmailDomain: domain => free.has(domain),
});

export const validatorsConfigured = true;

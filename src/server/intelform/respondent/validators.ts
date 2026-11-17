import {isValidPhoneNumber} from 'libphonenumber-js/max';

import {configureValidators} from '../../../lib/intelform/form/types/registry';
import freeDomains from './free-email-domains.json';

/**
 * Server-only answer checks for the field types (src/lib/intelform/form/types): strict phone
 * metadata ("max", too big for the browser bundle) and the free-email-domain list ("business
 * email only"). Every other type's check is its registry schema, run by validateSubmission.
 * Imported once by the respondent routes; idempotent.
 *
 * The domain list is vendored (free-email-domains.json, MIT, from the free-email-domains package
 * 1.16.7: free-email-domains.LICENSE.md): that package's install script fetches the list from the
 * network, which the store's supply-chain rule forbids (docs/agent/security.md A03). Refresh it by
 * replacing the JSON file in a reviewed commit.
 */
const free = new Set<string>(freeDomains);

/** True when `domain` (any case, an optional trailing dot) is a free or disposable mailbox provider. */
export function isFreeEmailDomain(domain: string): boolean {
  return free.has(domain.trim().toLowerCase().replace(/\.$/, ''));
}

configureValidators({
  phone: e164 => isValidPhoneNumber(e164),
  isFreeEmailDomain,
});

export const validatorsConfigured = true;

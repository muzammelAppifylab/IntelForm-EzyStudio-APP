import type {Abilities} from '../../../lib/types';
import {useMe} from '../../shared';

/**
 * Replaces IntelForm's old `useCan(permission)` (role table in the browser): the template's `/me`
 * answers with `abilities`, one flag per catalogue entry that has an `ability`
 * (src/server/permissions.ts). It only decides what the UI SHOWS; every route checks again.
 *
 *   const canEdit = useCan('editForms');
 */
export type Ability = keyof Abilities;

/** True when the signed-in member may use this ability. False while `/me` loads or when signed out. */
export function useCan(ability: Ability): boolean {
  const me = useMe();
  return Boolean(me.data?.abilities?.[ability]);
}

/** Several flags at once (one `/me` read): `const {editForms, deleteForms} = useAbilities()`. */
export function useAbilities(): Partial<Abilities> {
  return useMe().data?.abilities ?? {};
}

/**
 * IntelForm's old permission names → the template abilities they became. For porting code that
 * still says `can(role, 'forms.edit')`. Team / settings permissions map to the template's own
 * user admin and to IntelForm's App settings permission.
 */
export const LEGACY_PERMISSION_ABILITY = {
  'forms.view': 'viewForms',
  'forms.edit': 'editForms',
  'forms.delete': 'deleteForms',
  'responses.view': 'viewResponses',
  'responses.delete': 'deleteResponses',
  'templates.edit': 'editForms',
  'contacts.view': 'viewContacts',
  'contacts.edit': 'editContacts',
  'settings.manage': 'manageAppSettings',
} as const satisfies Record<string, string>;

export type LegacyPermission = keyof typeof LEGACY_PERMISSION_ABILITY;

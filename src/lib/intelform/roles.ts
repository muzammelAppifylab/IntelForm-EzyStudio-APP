/**
 * IntelForm's team roles, mapped onto the template's roles and permission catalogue.
 *
 * IntelForm had three roles (Owner, Editor, Viewer) and a hard-coded table of what each may do.
 * The template decides that with CODENAMES granted to ROLES (docs/agent/roles-and-permissions.md):
 *   Owner  → the template's `owner` role (holds `*`).
 *   Editor → the `editor` role (created by the intelform migration).
 *   Viewer → the `viewer` role (created by the intelform migration).
 *   The template's `admin` gets an Editor's codenames plus the app settings.
 * The codenames are declared ONCE, in src/server/permissions.ts (FORM_READ…APP_SETTINGS); owners
 * can change who holds them in /dashboard/roles. Routes check codenames (`requirePermission`),
 * the UI reads `me.abilities` (`viewForms`, `editForms`…). This file is browser-safe and only
 * describes the mapping for screens and tests: never gate anything on a role slug.
 */

/** IntelForm's role names, as slugs of the template's roles. */
export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an owner can hand out from /dashboard/users. Ownership is the platform's. */
export const INVITABLE_ROLES = ['editor', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** IntelForm's codenames (the same strings as `PERMISSIONS.*` in src/server/permissions.ts). */
export const INTELFORM_CODENAMES = {
  FORM_READ: 'site:form:read',
  FORM_WRITE: 'site:form:write',
  FORM_DELETE: 'site:form:delete',
  RESPONSE_READ: 'site:response:read',
  RESPONSE_DELETE: 'site:response:delete',
  CONTACT_READ: 'site:contact:read',
  CONTACT_WRITE: 'site:contact:write',
  APP_SETTINGS: 'site:intelform:settings',
} as const;
export type IntelformCodename = (typeof INTELFORM_CODENAMES)[keyof typeof INTELFORM_CODENAMES];

/** The `/me` ability flag of each codename. */
export const ABILITY_OF = {
  'site:form:read': 'viewForms',
  'site:form:write': 'editForms',
  'site:form:delete': 'deleteForms',
  'site:response:read': 'viewResponses',
  'site:response:delete': 'deleteResponses',
  'site:contact:read': 'viewContacts',
  'site:contact:write': 'editContacts',
  'site:intelform:settings': 'manageAppSettings',
} as const satisfies Record<IntelformCodename, string>;
export type IntelformAbility = (typeof ABILITY_OF)[IntelformCodename];

/**
 * IntelForm's old permission names → the codename that replaced each. `team.*` is gone: the
 * team is the template's users and roles screens (`site:user:*`, `site:role:*`).
 */
export const LEGACY_PERMISSION_CODENAME = {
  'forms.view': 'site:form:read',
  'forms.edit': 'site:form:write',
  'forms.delete': 'site:form:delete',
  'responses.view': 'site:response:read',
  'responses.delete': 'site:response:delete',
  'contacts.view': 'site:contact:read',
  'contacts.delete': 'site:contact:write',
  'templates.edit': 'site:form:write',
  'settings.manage': 'site:intelform:settings',
} as const satisfies Record<string, IntelformCodename>;
export type LegacyPermission = keyof typeof LEGACY_PERMISSION_CODENAME;

/** What each IntelForm role gets the first time the codenames are deployed. Owners hold `*`. */
export const DEFAULT_GRANTS: Record<Role | 'admin', readonly IntelformCodename[] | '*'> = {
  owner: '*',
  admin: [
    'site:form:read',
    'site:form:write',
    'site:form:delete',
    'site:response:read',
    'site:response:delete',
    'site:contact:read',
    'site:contact:write',
    'site:intelform:settings',
  ],
  editor: [
    'site:form:read',
    'site:form:write',
    'site:form:delete',
    'site:response:read',
    'site:response:delete',
    'site:contact:read',
    'site:contact:write',
  ],
  viewer: ['site:form:read', 'site:response:read', 'site:contact:read'],
};

/** The IntelForm abilities a set of `/me` ability flags grants (for UI checks). */
export type IntelformAbilities = Record<IntelformAbility, boolean>;

/** No abilities at all (a guest, or `/me` not loaded yet). */
export const NO_INTELFORM_ABILITIES: IntelformAbilities = {
  viewForms: false,
  editForms: false,
  deleteForms: false,
  viewResponses: false,
  deleteResponses: false,
  viewContacts: false,
  editContacts: false,
  manageAppSettings: false,
};

/**
 * IntelForm's old `can(role, permission)`, for code ported from it: true when the viewer's
 * `/me` abilities include the codename that replaced the permission. UI only; routes use
 * `requirePermission` / `can` from src/platform/guards.ts.
 */
export function canDo(abilities: Partial<Record<string, boolean>> | null | undefined, permission: LegacyPermission): boolean {
  return abilities?.[ABILITY_OF[LEGACY_PERMISSION_CODENAME[permission]]] === true;
}

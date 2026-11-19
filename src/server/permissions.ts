import {abilitiesOf, type AbilitiesOf, codenamesOf, CORE_PERMISSIONS, definePermissions} from '../platform/auth/codenames';

/**
 * THE permission catalogue: every codename this site checks, declared ONCE.
 * Adding a permission is one entry here, plus its line in tests/permissions.test.ts
 * (docs/agent/roles-and-permissions.md):
 *
 *   - `PERMISSIONS.<KEY>` is its codename, for `requirePermission` / `can`;
 *   - `ability` adds a flag to `/me` `abilities` (and to the `Abilities` type)
 *     for the UI: portal nav items, buttons, `pageContext()` pages;
 *   - the row reaches the `permissions` table (the roles screen) on the next
 *     signed-in request after deploy, and `roles` get it that first time only
 *     (`src/platform/permission-sync.ts`). No migration.
 *   - tests/permissions.test.ts lists every shipped codename and ability, so
 *     `npm test` fails until you add the new one there too (on purpose: a
 *     renamed or lost permission never slips through).
 *
 * Never rename or reuse a shipped codename: roles hold it by name. Browser-safe
 * (no server imports): the portal reads the `Abilities` type from here.
 */
export const CATALOGUE = definePermissions({
  ...CORE_PERMISSIONS,

  // ----------------------------------------------------------------- Users
  /** Add people by hand: email them an invite or set their first password (routes/team.ts). */
  USER_INVITE: {
    codename: 'site:user:invite',
    title: 'Add and invite users',
    description: 'Add people by hand with their roles, then email them an invite or set their first password.',
    group: 'Users',
    ability: 'inviteUsers',
    roles: ['admin'],
  },

  // ------------------------------------------------------------- IntelForm
  // IntelForm's old team roles map onto the template's: Owner is `owner` (holds `*`), Editor and
  // Viewer are the `editor` / `viewer` roles the intelform migration creates, and `admin` gets
  // what an Editor has plus the app settings.

  /** Open the forms list, the builder (read only) and a form's settings. */
  FORM_READ: {
    codename: 'site:form:read',
    title: 'See forms',
    description: 'Open the forms list and look at any form, its settings and its share links.',
    group: 'Forms',
    ability: 'viewForms',
    roles: ['admin', 'editor', 'viewer'],
  },
  /** Create, edit, duplicate, publish, close and reopen forms; settings, webhooks, saved themes and templates. */
  FORM_WRITE: {
    codename: 'site:form:write',
    title: 'Create and edit forms',
    description: 'Create, edit, duplicate, publish, close and reopen forms, their settings and webhooks, saved themes and templates.',
    group: 'Forms',
    ability: 'editForms',
    roles: ['admin', 'editor'],
  },
  /** Delete a form with all its responses. */
  FORM_DELETE: {
    codename: 'site:form:delete',
    title: 'Delete forms',
    description: 'Delete a form together with every response it collected.',
    group: 'Forms',
    ability: 'deleteForms',
    roles: ['admin', 'editor'],
  },
  /** Read and export responses, summaries and analytics. */
  RESPONSE_READ: {
    codename: 'site:response:read',
    title: 'See responses',
    description: 'Read, summarise and export the responses of every form.',
    group: 'Responses',
    ability: 'viewResponses',
    roles: ['admin', 'editor', 'viewer'],
  },
  /** Delete single responses or many at once. */
  RESPONSE_DELETE: {
    codename: 'site:response:delete',
    title: 'Delete responses',
    description: 'Delete one response or many at once.',
    group: 'Responses',
    ability: 'deleteResponses',
    roles: ['admin', 'editor'],
  },
  /** Open the contacts list and a contact's responses, and export them. */
  CONTACT_READ: {
    codename: 'site:contact:read',
    title: 'See contacts',
    description: 'Open the contacts list and every response a contact sent, and export contacts.',
    group: 'Contacts',
    ability: 'viewContacts',
    roles: ['admin', 'editor', 'viewer'],
  },
  /** Erase contacts (deletes every response they sent). */
  CONTACT_WRITE: {
    codename: 'site:contact:write',
    title: 'Erase contacts',
    description: 'Erase contacts, deleting every response they sent.',
    group: 'Contacts',
    ability: 'editContacts',
    roles: ['admin', 'editor'],
  },
  /** IntelForm's app settings: branding, response retention, the public site, notification defaults. */
  APP_SETTINGS: {
    codename: 'site:intelform:settings',
    title: 'Manage form app settings',
    description: 'Change branding, response retention, the public site and notification defaults.',
    group: 'Settings',
    ability: 'manageAppSettings',
    roles: ['admin'],
  },
});

/** Codenames by key: `PERMISSIONS.FORM_READ` is `'site:form:read'`. */
export const PERMISSIONS = codenamesOf(CATALOGUE);

export type Codename = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** What the UI may SHOW the visitor (`/me`); every route checks again. */
export type Abilities = AbilitiesOf<typeof CATALOGUE>;

/** The abilities a set of granted codenames gives (`/me`). */
export const abilitiesFor = (permissions: ReadonlySet<string>): Abilities => abilitiesOf(CATALOGUE, permissions);

/** A guest's abilities: every flag false. */
export const NO_ABILITIES: Abilities = abilitiesFor(new Set());

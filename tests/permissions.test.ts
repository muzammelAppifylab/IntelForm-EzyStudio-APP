import {describe, expect, it} from 'vitest';

import {
  abilitiesOf,
  allows,
  catalogueProblems,
  CORE,
  definePermissions,
  ownCodename,
  scopeOf,
} from '../src/platform/auth/codenames';
import {type Abilities, abilitiesFor, CATALOGUE, NO_ABILITIES, PERMISSIONS} from '../src/server/permissions';

describe('the permission catalogue', () => {
  it('is well formed', () => {
    expect(catalogueProblems(CATALOGUE)).toEqual([]);
  });

  it('keeps the shipped codenames and ability keys', () => {
    expect(CORE.USER_READ).toBe('site:user:read');
    expect(CORE.USER_UPDATE).toBe('site:user:update');
    expect(CORE.ROLE_READ).toBe('site:role:read');
    expect(CORE.ROLE_UPDATE).toBe('site:role:update');
    expect(CORE.AUDIT_READ).toBe('site:audit:read');
    expect(PERMISSIONS.FORM_READ).toBe('site:form:read');
    expect(PERMISSIONS.FORM_WRITE).toBe('site:form:write');
    expect(PERMISSIONS.FORM_DELETE).toBe('site:form:delete');
    expect(PERMISSIONS.RESPONSE_READ).toBe('site:response:read');
    expect(PERMISSIONS.RESPONSE_DELETE).toBe('site:response:delete');
    expect(PERMISSIONS.RESPONSE_EXPORT).toBe('site:response:export');
    expect(PERMISSIONS.CONTACT_READ).toBe('site:contact:read');
    expect(PERMISSIONS.CONTACT_WRITE).toBe('site:contact:write');
    expect(PERMISSIONS.APP_SETTINGS).toBe('site:intelform:settings');
    expect(PERMISSIONS.USER_INVITE).toBe('site:user:invite');
    expect(Object.keys(NO_ABILITIES).sort()).toEqual(
      [
        'editRoles',
        'manageRoles',
        'manageUsers',
        'readAudit',
        'updateUsers',
        'inviteUsers',
        'viewForms',
        'editForms',
        'deleteForms',
        'viewResponses',
        'exportResponses',
        'deleteResponses',
        'viewContacts',
        'editContacts',
        'manageAppSettings',
      ].sort()
    );
    expect(Object.values(NO_ABILITIES).every(v => v === false)).toBe(true);
  });

  it('derives the abilities from granted codenames, wildcards included', () => {
    const owner = abilitiesFor(new Set(['*']));
    expect(Object.values(owner).every(Boolean)).toBe(true);
    const admin = abilitiesFor(
      new Set([
        'site:user:*',
        'site:role:read',
        'site:audit:read',
        'site:form:read',
        'site:form:write',
        'site:form:delete',
        'site:response:read',
        'site:response:delete',
        'site:contact:read',
        'site:contact:write',
        'site:intelform:settings',
      ])
    );
    expect(admin).toEqual({
      manageUsers: true,
      updateUsers: true,
      inviteUsers: true,
      manageRoles: true,
      editRoles: false,
      readAudit: true,
      viewForms: true,
      editForms: true,
      deleteForms: true,
      viewResponses: true,
      deleteResponses: true,
      // Granted to admins by its catalogue entry when it first reaches the database (not in this set).
      exportResponses: false,
      viewContacts: true,
      editContacts: true,
      manageAppSettings: true,
    } satisfies Abilities);
    // IntelForm's Viewer: reads forms, responses and contacts, changes nothing.
    const viewer = abilitiesFor(new Set(['site:form:read', 'site:response:read', 'site:contact:read']));
    expect(
      Object.entries(viewer)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .sort()
    ).toEqual(['viewContacts', 'viewForms', 'viewResponses']);
    // The roles each entry is first granted to.
    expect(CATALOGUE.FORM_READ.roles).toEqual(['admin', 'editor', 'viewer']);
    expect(CATALOGUE.FORM_WRITE.roles).toEqual(['admin', 'editor']);
    expect(CATALOGUE.APP_SETTINGS.roles).toEqual(['admin']);
    // Whoever could export before; never the store's read-only demo role.
    expect(CATALOGUE.RESPONSE_EXPORT.roles).toEqual(['admin', 'editor', 'viewer']);
    expect(CATALOGUE.USER_INVITE.roles).toEqual(['admin']);
    expect(CATALOGUE.USER_INVITE.roles).toEqual(['admin']);
    // The type is exact: a key nobody declared does not exist.
    // @ts-expect-error not in the catalogue
    void NO_ABILITIES.manageEverything;
  });

  it('refuses a malformed entry at load', () => {
    expect(() => definePermissions({BAD: {codename: 'Site:Bad', title: 'Bad', group: 'X'}})).toThrow(/bad codename/);
    expect(() =>
      definePermissions({
        A: {codename: 'site:a:read', title: 'A', group: 'X', ability: 'seeA'},
        B: {codename: 'site:a:read', title: 'B', group: 'X', ability: 'seeA'},
      })
    ).toThrow(/declared twice/);
    expect(() => definePermissions({T: {codename: 'site:t:read', title: '', group: 'X'}})).toThrow(/title/);
  });

  it('a new entry is one edit: codename, ability and type follow', () => {
    const site = definePermissions({
      CRM_READ: {codename: 'site:crm:read', title: 'See contacts', group: 'CRM', ability: 'seeContacts', roles: ['admin']},
    });
    const flags = abilitiesOf(site, new Set(['site:crm:*']));
    expect(flags).toEqual({seeContacts: true});
    const typed: {seeContacts: boolean} = flags;
    expect(typed.seeContacts).toBe(true);
  });
});

describe('own-records permissions', () => {
  const ALL = new Set(['site:note:update']);
  const OWN = new Set(['site:note:update_own']);
  const NONE = new Set<string>(['site:note:read']);

  it('names the own variant', () => {
    expect(ownCodename('site:note:update')).toBe('site:note:update_own');
    expect(ownCodename('site:note:update_own')).toBe('site:note:update_own');
  });

  it('scopes all / own / none', () => {
    expect(scopeOf(ALL, 'site:note:update')).toBe('all');
    expect(scopeOf(OWN, 'site:note:update')).toBe('own');
    expect(scopeOf(NONE, 'site:note:update')).toBe('none');
    expect(scopeOf(new Set(['site:note:*']), 'site:note:update')).toBe('all');
    expect(scopeOf(new Set(['*']), 'site:note:update')).toBe('all');
  });

  it('allows the own variant only on the viewer’s own records', () => {
    expect(allows(ALL, 'site:note:update', 7, 99)).toBe(true);
    expect(allows(OWN, 'site:note:update', 7, 7)).toBe(true);
    expect(allows(OWN, 'site:note:update', 7, 99)).toBe(false);
    expect(allows(OWN, 'site:note:update', 7, null)).toBe(false); // nobody's record
    expect(allows(OWN, 'site:note:update', null, null)).toBe(false); // a guest
    expect(allows(OWN, 'site:note:update', 7, undefined)).toBe(false);
    expect(allows(NONE, 'site:note:update', 7, 7)).toBe(false);
  });
});

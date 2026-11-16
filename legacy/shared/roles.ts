/** Team roles. Respondents have no account, so they are not a role here. */
export const ROLES = ['owner', 'editor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/** Roles the Owner can hand out by invite or role change. Ownership moves only by transfer. */
export const INVITABLE_ROLES = ['editor', 'viewer'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

/**
 * What each role may do (PRD "Users and roles"). The server checks these on every route;
 * the client uses the same table only to hide controls.
 */
const PERMISSIONS = {
  'forms.view': ['owner', 'editor', 'viewer'],
  'forms.edit': ['owner', 'editor'],
  'responses.view': ['owner', 'editor', 'viewer'],
  'responses.delete': ['owner', 'editor'],
  'templates.edit': ['owner', 'editor'],
  'team.view': ['owner', 'editor', 'viewer'],
  'team.manage': ['owner'],
  'settings.manage': ['owner'],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role)
}

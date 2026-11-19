/**
 * THE list of activity-log actions, grouped for the Activity screen's filter.
 * Browser-safe: the server builds its `action IN (...)` filter from it and the
 * portal reads the same groups for its menu, so they never drift apart.
 *
 * Add an action here when a route starts writing it (`grep -rn "action: '" src`):
 * `tests/activity.test.ts` fails on an app action that has no group.
 */
export const ACTIVITY_CATEGORIES = {
  account: {
    label: 'Sign-ins & accounts',
    actions: [
      'registered',
      'user_registered',
      'signed_in_with_password',
      'signed_in_with_code',
      'owner_signed_in',
      'logout_all',
      'device_signed_out',
      'email_verified',
      'email_change_requested',
      'email_change_cancelled',
      'email_changed',
      'account_deleted',
    ],
  },
  security: {
    label: 'Security',
    actions: [
      'sign_in_failed',
      'password_changed',
      'password_reset',
      'password_reset_requested',
      'two_factor_enabled',
      'two_factor_disabled',
      'owner_link_two_factor',
      'recovery_codes_renewed',
      'recovery_code_used',
      'refresh_reuse_detected',
      'user_two_factor_disabled',
    ],
  },
  team: {
    label: 'Users & roles',
    actions: [
      'user_added',
      'user_invite_sent',
      'user_sessions_revoked',
      'user_roles_changed',
      'user_suspended',
      'user_reactivated',
      'role_created',
      'role_updated',
      'role_deleted',
      'owner_claimed',
      'owner_transferred',
      'owner_removed',
    ],
  },
  forms: {
    label: 'Forms',
    actions: [
      'form_created',
      'form_duplicated',
      'form_published',
      'form_closed',
      'form_reopened',
      'form_deleted',
      'form_saved_as_template',
      'webhook_saved',
      'webhook_removed',
      'webhook_secret_rotated',
      'template_updated',
      'template_deleted',
      'theme_saved',
      'theme_deleted',
    ],
  },
  responses: {
    label: 'Responses & data',
    actions: ['responses_deleted', 'contacts_deleted', 'export_started'],
  },
  settings: {
    label: 'Settings',
    actions: ['app_settings_changed'],
  },
} as const satisfies Record<string, {label: string; actions: readonly string[]}>;

export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

export const ACTIVITY_CATEGORY_KEYS = Object.keys(ACTIVITY_CATEGORIES) as ActivityCategory[];

const BY_ACTION = new Map<string, ActivityCategory>(
  ACTIVITY_CATEGORY_KEYS.flatMap(key => ACTIVITY_CATEGORIES[key].actions.map(action => [action, key] as const))
);

/** The group an action belongs to; `null` for one this list doesn't know yet. */
export const categoryOf = (action: string): ActivityCategory | null => BY_ACTION.get(action) ?? null;

export const isActivityCategory = (value: string): value is ActivityCategory =>
  Object.prototype.hasOwnProperty.call(ACTIVITY_CATEGORIES, value);

/** One row of `GET /site-api/activity`. */
export interface ActivityRow {
  /** A bigint, as a string. Pass back as `?before=`. */
  id: string;
  actor: {id: number; name: string} | null;
  action: string;
  category: ActivityCategory | null;
  /** `type:id` (`user:12`, `form:<uuid>`, `role:editor`), or `null`. */
  target: string | null;
  /** The thing acted on, by name, when it still exists ("Sam Rivera", "Customer survey"). */
  targetName: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityPage {
  events: ActivityRow[];
  nextBefore: string | null;
}

/** The people who did something recently: the Activity screen's "Person" filter. */
export interface ActivityPeople {
  people: {id: number; name: string}[];
}

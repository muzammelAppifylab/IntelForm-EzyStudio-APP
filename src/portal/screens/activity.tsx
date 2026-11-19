import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_KEYS,
  type ActivityCategory,
  type ActivityRow,
} from "../../lib/activity";
import {
  ACTIVITY_PAGE_SIZES,
  activityFilterOf,
  type ActivityFilter,
  activityPageSize,
  activityPeopleQuery,
  activityQuery,
} from "../queries";
import { ago, when } from "../shared";
import {
  Badge,
  Button,
  Card,
  type Column,
  Combobox,
  DataTable,
  DatePicker,
  DefinitionList,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  Icon,
  IconButton,
  type IconName,
  PageHeader,
  Person,
  Select,
  type Tone,
} from "../ui";

// ------------------------------------------------------------------ words --

/** One event in words: what happened (the actor is its own column), its icon and an extra line. */
type Line = {
  what: ReactNode;
  icon: IconName;
  tone?: "brand" | "warning" | "danger";
  detail?: string;
};

const CATEGORY_TONE: Record<ActivityCategory, Tone> = {
  account: "neutral",
  security: "warning",
  team: "info",
  forms: "brand",
  responses: "success",
  settings: "neutral",
  spam: "warning",
};

const EXPORT_KINDS: Record<string, string> = {
  responses: "Responses (CSV)",
  contacts: "Contacts (CSV)",
  all: "All responses (ZIP)",
};

const SETTINGS_SECTIONS: Record<string, string> = {
  general: "General",
  branding: "Branding",
  notifications: "Notifications",
  data: "Data",
  site: "Website",
  legal: "Legal pages",
  spam: "Spam protection",
};

const CONFIRM_SKIPPED: Record<string, string> = {
  ip: "one network asked for too many this hour",
  form: "the form reached its hourly limit",
  recipient: "that address already had one today",
  site: "the site reached its daily limit",
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const splitTarget = (target: string | null): [string | null, string] => {
  if (!target) return [null, ""];
  const at = target.indexOf(":");
  return at < 0 ? [target, ""] : [target.slice(0, at), target.slice(at + 1)];
};

/** A form by its current title (a link while it exists), else the title it had, else "a form". */
function FormName({ event }: { event: ActivityRow }) {
  const [kind, id] = splitTarget(event.target);
  const title = event.targetName ?? text(event.meta?.title);
  if (kind === "form" && event.targetName && id) {
    return (
      <Link
        to="/forms/$formId"
        params={{ formId: id }}
        className="activity-target"
      >
        “{event.targetName}”
      </Link>
    );
  }
  return <>{title ? `“${title}”` : "a form"}</>;
}

const named = (event: ActivityRow, fallback: string) => {
  const name = event.targetName ?? text(event.meta?.title);
  return name ? `“${name}”` : fallback;
};

/**
 * Every action the server writes (`src/lib/activity.ts` lists them). An action
 * not listed here still shows, in its own words.
 */
function describe(event: ActivityRow): Line {
  const [kind, id] = splitTarget(event.target);
  const onSelf =
    kind === "user" && event.actor !== null && String(event.actor.id) === id;
  const user =
    kind === "user" && id
      ? onSelf
        ? "themselves"
        : (event.targetName ?? `user #${id}`)
      : "someone";
  const role =
    kind === "role" && id
      ? `the ${event.targetName ? `“${event.targetName}”` : `“${id}”`} role`
      : "a role";
  const meta = event.meta ?? {};

  switch (event.action) {
    // Sign-ins & accounts
    case "user_registered":
    case "registered":
      return { what: "Signed up", icon: "user-plus", tone: "brand" };
    case "signed_in_with_password":
      return { what: "Signed in with their password", icon: "user" };
    case "signed_in_with_code":
      return { what: "Signed in with an emailed code", icon: "user" };
    case "owner_signed_in":
      return { what: "Signed in from the platform as the owner", icon: "user" };
    case "logout_all":
      return { what: "Signed out on every device", icon: "log-out" };
    case "device_signed_out":
      return { what: "Signed out one of their devices", icon: "log-out" };
    case "email_verified":
      return { what: "Confirmed their email", icon: "mail" };
    case "email_change_requested":
      return { what: "Asked to change their email", icon: "mail" };
    case "email_change_cancelled":
      return {
        what: `An email change for ${user} was cancelled from the old address`,
        icon: "mail",
        tone: "warning",
      };
    case "email_changed":
      return { what: "Changed their email", icon: "mail" };
    case "account_deleted":
      return {
        what: `The account of ${user} was deleted`,
        icon: "trash",
        tone: "danger",
      };

    // Security
    case "sign_in_failed":
      return {
        what: `A sign-in to ${user} failed (wrong password)`,
        icon: "alert",
        tone: "warning",
      };
    case "password_changed":
      return { what: "Changed their password", icon: "lock" };
    case "password_reset":
      return { what: "Reset their password", icon: "lock" };
    case "password_reset_requested":
      return { what: `A password reset was asked for ${user}`, icon: "lock" };
    case "two_factor_enabled":
      return { what: "Turned on two-step sign-in", icon: "key", tone: "brand" };
    case "two_factor_disabled":
      return {
        what: "Turned off two-step sign-in",
        icon: "key",
        tone: "warning",
      };
    case "owner_link_two_factor":
      return {
        what: "Signed in from the platform with two-step sign-in",
        icon: "key",
      };
    case "recovery_codes_renewed":
      return { what: "Made new recovery codes", icon: "key" };
    case "recovery_code_used":
      return {
        what: "Signed in with a recovery code",
        icon: "key",
        tone: "warning",
      };
    case "user_two_factor_disabled":
      return {
        what: `Turned off two-step sign-in for ${user}`,
        icon: "key",
        tone: "warning",
      };
    case "refresh_reuse_detected":
      return {
        what: `A reused sign-in token was refused, so ${user} was signed out`,
        icon: "alert",
        tone: "warning",
      };

    // Users & roles
    case "user_added":
      return {
        what: `Added ${user}`,
        icon: "user-plus",
        tone: "brand",
        detail:
          meta.invited === true ? "An invitation email was sent" : undefined,
      };
    case "user_invite_sent":
      return { what: `Sent ${user} an invitation email`, icon: "send" };
    case "user_sessions_revoked":
      return { what: `Signed ${user} out everywhere`, icon: "log-out" };
    case "user_roles_changed":
      return {
        what: onSelf
          ? "Changed their own roles"
          : `Changed the roles of ${user}`,
        icon: "shield",
        detail: roleChanges(meta),
      };
    case "user_suspended":
      return { what: `Suspended ${user}`, icon: "ban", tone: "danger" };
    case "user_reactivated":
      return { what: `Reactivated ${user}`, icon: "user" };
    case "role_created":
      return { what: `Created ${role}`, icon: "shield" };
    case "role_updated":
      return { what: `Edited ${role}`, icon: "shield" };
    case "role_deleted":
      return { what: `Deleted ${role}`, icon: "trash", tone: "danger" };
    case "owner_claimed":
      return { what: "Became the owner", icon: "shield", tone: "brand" };
    case "owner_transferred":
      return { what: `Took the owner seat from ${user}`, icon: "shield" };
    case "owner_removed":
      return {
        what: `The owner role was taken from ${user}`,
        icon: "shield",
        tone: "warning",
      };

    // Forms
    case "form_created":
      return {
        what: (
          <>
            Created the form <FormName event={event} />
          </>
        ),
        icon: "file-plus",
        tone: "brand",
        detail: meta.fromTemplate === true ? "From a template" : undefined,
      };
    case "form_duplicated":
      return {
        what: (
          <>
            Duplicated a form as <FormName event={event} />
          </>
        ),
        icon: "copy-plus",
        detail: text(meta.source)
          ? `Copied from “${text(meta.source)}”`
          : undefined,
      };
    case "form_published": {
      const version = count(meta.version);
      return {
        what: (
          <>
            Published <FormName event={event} />
          </>
        ),
        icon: "rocket",
        tone: "brand",
        detail: version ? `Version ${version} is live` : undefined,
      };
    }
    case "form_closed":
      return {
        what: (
          <>
            Closed <FormName event={event} /> to new responses
          </>
        ),
        icon: "lock",
        tone: "warning",
      };
    case "form_reopened":
      return {
        what: (
          <>
            Reopened <FormName event={event} />
          </>
        ),
        icon: "lock-open",
      };
    case "form_deleted":
      return {
        what: (
          <>
            Deleted the form <FormName event={event} />
          </>
        ),
        icon: "trash",
        tone: "danger",
      };
    case "form_saved_as_template":
      return {
        what: `Saved a form as the template ${named(event, "a template")}`,
        icon: "template",
        detail: text(meta.source) ? `From “${text(meta.source)}”` : undefined,
      };
    case "webhook_saved":
      return {
        what: (
          <>
            Changed the webhook of <FormName event={event} />
          </>
        ),
        icon: "webhook",
      };
    case "webhook_removed":
      return {
        what: (
          <>
            Removed the webhook of <FormName event={event} />
          </>
        ),
        icon: "webhook",
        tone: "warning",
      };
    case "webhook_secret_rotated":
      return {
        what: (
          <>
            Made a new webhook signing secret for <FormName event={event} />
          </>
        ),
        icon: "key",
      };
    case "template_updated":
      return {
        what: `Edited the template ${named(event, "a template")}`,
        icon: "template",
      };
    case "template_deleted":
      return {
        what: `Deleted the template ${named(event, "a template")}`,
        icon: "trash",
        tone: "danger",
      };
    case "theme_saved":
      return {
        what: `Saved the theme ${named(event, "a theme")}`,
        icon: "palette",
      };
    case "theme_deleted":
      return {
        what: `Deleted the theme ${named(event, "a theme")}`,
        icon: "trash",
        tone: "danger",
      };

    // Responses & data
    case "responses_deleted": {
      const n = count(meta.count) ?? 1;
      return {
        what: (
          <>
            Deleted {plural(n, "response")} from <FormName event={event} />
          </>
        ),
        icon: "trash",
        tone: "danger",
      };
    }
    case "contacts_deleted": {
      const contacts = count(meta.contacts) ?? 0;
      const responses = count(meta.responses) ?? 0;
      return {
        what: `Erased ${plural(contacts, "contact")}`,
        icon: "user-x",
        tone: "danger",
        detail: responses
          ? `With their ${plural(responses, "response")}`
          : undefined,
      };
    }
    case "export_started": {
      const exportKind = text(meta.kind);
      return {
        what:
          kind === "form" ? (
            <>
              Exported the responses of <FormName event={event} />
            </>
          ) : (
            "Started an export"
          ),
        icon: "download",
        detail: exportKind
          ? (EXPORT_KINDS[exportKind] ?? exportKind)
          : undefined,
      };
    }

    // Settings
    case "app_settings_changed": {
      const sections = Array.isArray(meta.sections)
        ? meta.sections
            .filter((s): s is string => typeof s === "string")
            .map((s) => SETTINGS_SECTIONS[s] ?? s)
        : [];
      return {
        what: "Changed the app settings",
        icon: "settings",
        detail: sections.length ? sections.join(", ") : undefined,
      };
    }

    // Spam protection
    case "visitor_blocked":
      return meta.automatic === false
        ? { what: "Blocked a visitor’s network", icon: "ban", tone: "warning" }
        : {
            what: (
              <>
                Blocked a network that kept going over the limits of <FormName event={event} />
              </>
            ),
            icon: "ban",
            tone: "warning",
            detail: typeof meta.strikes === "number" ? `${meta.strikes} refused responses` : undefined,
          };
    case "visitor_unblocked":
      return { what: "Unblocked a visitor’s network", icon: "lock-open" };
    case "spam_limit_reached":
      return {
        what: (
          <>
            Spam protection turned responses away from <FormName event={event} />
          </>
        ),
        icon: "shield",
        tone: "warning",
        detail: meta.limit === "site" ? "The site’s per-minute limit" : "The form’s per-minute limit",
      };
    case "confirmation_skipped":
      return {
        what: (
          <>
            Skipped confirmation emails for <FormName event={event} />
          </>
        ),
        icon: "mail",
        tone: "warning",
        detail: CONFIRM_SKIPPED[text(meta.reason) ?? ""] ?? undefined,
      };

    default:
      return {
        what:
          event.action
            .replaceAll("_", " ")
            .replace(/^./, (c) => c.toUpperCase()) +
          (event.target ? ` (${event.target})` : ""),
        icon: "activity",
      };
  }
}

/** `user_roles_changed` keeps `{added, removed}`: "Added admin · Removed editor". */
function roleChanges(meta: Record<string, unknown>): string | undefined {
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  const added = list(meta.added);
  const removed = list(meta.removed);
  const parts = [
    added.length ? `Added ${added.join(", ")}` : "",
    removed.length ? `Removed ${removed.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

// ---------------------------------------------------------------- filters --

type DatePreset = "" | "today" | "7d" | "30d" | "90d" | "custom";

const DATE_PRESETS: { value: DatePreset; label: string; days?: number }[] = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "custom", label: "Custom range" },
];

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return isoDay(date);
};

/** Which preset the URL's dates match, so the menu shows it after a reload. */
function presetOf(filter: ActivityFilter): DatePreset {
  if (!filter.from && !filter.to) return "";
  const today = isoDay(new Date());
  if (filter.to === today) {
    const match = DATE_PRESETS.find(
      (p) => p.days && filter.from === daysAgo(p.days - 1),
    );
    if (match) return match.value;
  }
  return "custom";
}

const KIND_OPTIONS = [
  { value: "", label: "Everything" },
  ...ACTIVITY_CATEGORY_KEYS.map((key) => ({
    value: key,
    label: ACTIVITY_CATEGORIES[key].label,
  })),
];

// ----------------------------------------------------------------- screen --

/** `/activity` (site:audit:read): everything that happened, newest first, with filters. */
export function Activity() {
  const navigate = useNavigate({ from: "/activity" });
  const filter = activityFilterOf(useSearch({ from: "/activity" }));
  const [customDates, setCustomDates] = useState(false);
  const [open, setOpen] = useState<ActivityRow | null>(null);

  // Keyset pages: the cursor of every page so far, so Previous goes back exactly. A new
  // filter starts again at page 1 (the stack belongs to the filter it was built for).
  const filterKey = JSON.stringify(filter);
  const [paging, setPaging] = useState({ key: filterKey, cursors: [""] });
  const cursors = paging.key === filterKey ? paging.cursors : [""];
  const pageIndex = cursors.length - 1;
  const size = activityPageSize(filter.size);

  const queryClient = useQueryClient();
  const events = useQuery({
    ...activityQuery(filter, cursors[pageIndex]),
    placeholderData: keepPreviousData,
  });
  const people = useQuery(activityPeopleQuery);
  const rows = events.data?.events;
  const nextBefore = events.data?.nextBefore ?? null;
  const turning = events.isPlaceholderData && events.isFetching;

  // The next page is one click away: fetch it now so Next feels instant.
  useEffect(() => {
    if (nextBefore && !events.isPlaceholderData)
      void queryClient.prefetchQuery(activityQuery(filter, nextBefore));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextBefore, filterKey, events.isPlaceholderData, queryClient]);

  const goTo = (next: string[]) => {
    setPaging({ key: filterKey, cursors: next });
    document
      .querySelector(".screen-activity")
      ?.scrollIntoView({ block: "start" });
  };
  const firstRow = pageIndex * size + 1;

  const preset = customDates ? "custom" : presetOf(filter);
  const filtered = Boolean(
    filter.kind || filter.person || filter.from || filter.to,
  );
  const today = isoDay(new Date());

  const setFilter = (next: Partial<ActivityFilter>) => {
    const merged = { ...filter, ...next };
    void navigate({
      search: Object.fromEntries(
        Object.entries(merged).filter(([, value]) => value),
      ) as Partial<ActivityFilter>,
      replace: true,
    });
  };

  const pickPreset = (value: DatePreset) => {
    if (value === "custom") {
      setCustomDates(true);
      return;
    }
    setCustomDates(false);
    const days = DATE_PRESETS.find((p) => p.value === value)?.days;
    setFilter(
      days ? { from: daysAgo(days - 1), to: today } : { from: "", to: "" },
    );
  };

  const personOptions = [
    { value: "", label: "Everyone" },
    ...(people.data?.people ?? []).map((p) => ({
      value: String(p.id),
      label: p.name,
    })),
  ];
  if (filter.person && !personOptions.some((o) => o.value === filter.person)) {
    personOptions.push({
      value: filter.person,
      label: `User #${filter.person}`,
    });
  }

  const columns: Column<ActivityRow>[] = [
    {
      key: "event",
      header: "Event",
      cell: (event) => {
        const line = describe(event);
        return (
          <span className="activity-event">
            <span className="list-row-icon" data-tone={line.tone}>
              <Icon name={line.icon} size={16} />
            </span>
            <span className="activity-event-text">
              <span className="activity-event-title">{line.what}</span>
              {line.detail && (
                <span className="activity-event-sub">{line.detail}</span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: "by",
      header: "By",
      cell: (event) =>
        event.actor ? (
          <button
            type="button"
            className="activity-person"
            title={`Show only ${event.actor.name}`}
            onClick={() => setFilter({ person: String(event.actor!.id) })}
          >
            <Person name={event.actor.name} />
          </button>
        ) : (
          <span className="muted">System</span>
        ),
    },
    {
      key: "kind",
      header: "Kind",
      width: "shrink",
      hideOnMobile: true,
      cell: (event) =>
        event.category ? (
          <Badge tone={CATEGORY_TONE[event.category]}>
            {ACTIVITY_CATEGORIES[event.category].label}
          </Badge>
        ) : (
          <Badge>Other</Badge>
        ),
    },
    {
      key: "when",
      header: "When",
      width: "shrink",
      cell: (event) => (
        <time
          className="muted activity-when"
          dateTime={event.createdAt}
          title={when(event.createdAt)}
        >
          {ago(event.createdAt)}
        </time>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      actions: true,
      cell: (event) => (
        <IconButton
          icon="eye"
          label="See the details"
          size="sm"
          onClick={() => setOpen(event)}
        />
      ),
    },
  ];

  return (
    <div className="app-page screen-activity">
      <PageHeader
        title="Activity"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            pending={events.isFetching && !events.isPending && !turning}
            pendingLabel="Refreshing…"
            onClick={() => {
              // Newest first: a refresh shows page 1 again, with whatever just happened.
              setPaging({ key: filterKey, cursors: [""] });
              void queryClient.invalidateQueries({ queryKey: ["audit"] });
            }}
          >
            Refresh
          </Button>
        }
      />

      <Card>
        <div
          className="activity-filters"
          role="search"
          aria-label="Filter the activity"
        >
          <Field id="activity-kind" label="Kind">
            <Select
              id="activity-kind"
              options={KIND_OPTIONS}
              value={filter.kind}
              onChange={(event) => setFilter({ kind: event.target.value })}
            />
          </Field>
          <Field id="activity-person" label="Person">
            <Combobox
              id="activity-person"
              value={filter.person}
              onChange={(person) => setFilter({ person })}
              options={personOptions}
              placeholder="Everyone"
              searchLabel="Find a person"
              emptyText="Nobody by that name acted recently."
            />
          </Field>
          <Field id="activity-dates" label="Date">
            <Select
              id="activity-dates"
              options={DATE_PRESETS.map(({ value, label }) => ({
                value,
                label,
              }))}
              value={preset}
              onChange={(event) => pickPreset(event.target.value as DatePreset)}
            />
          </Field>
          {preset === "custom" && (
            <>
              <Field id="activity-from" label="From">
                <DatePicker
                  id="activity-from"
                  value={filter.from || null}
                  max={filter.to || today}
                  clearable
                  placeholder="First day"
                  onChange={(from) => setFilter({ from: from ?? "" })}
                />
              </Field>
              <Field id="activity-to" label="To">
                <DatePicker
                  id="activity-to"
                  value={filter.to || null}
                  min={filter.from || undefined}
                  max={today}
                  clearable
                  placeholder="Last day"
                  onChange={(to) => setFilter({ to: to ?? "" })}
                />
              </Field>
            </>
          )}
          {filtered && (
            <div className="activity-filters-clear">
              <Button
                variant="ghost"
                icon="x"
                onClick={() => {
                  setCustomDates(false);
                  void navigate({
                    search: filter.size ? { size: filter.size } : {},
                    replace: true,
                  });
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="activity-table" aria-busy={turning || undefined}>
        <Card flush>
          <DataTable
            caption="Activity"
            columns={columns}
            rows={rows}
            rowKey={(event) => event.id}
            loading={events.isPending}
            error={events.error}
            empty={
              filtered ? (
                <EmptyState
                  icon="search-x"
                  title="Nothing matches these filters"
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCustomDates(false);
                        void navigate({
                          search: filter.size ? { size: filter.size } : {},
                          replace: true,
                        });
                      }}
                    >
                      Show everything
                    </Button>
                  }
                >
                  Try another kind, person or date range.
                </EmptyState>
              ) : (
                <EmptyState icon="activity" title="Nothing yet">
                  Sign-ins, account and role changes, and work on forms and
                  responses show here as they happen.
                </EmptyState>
              )
            }
          />
        </Card>
      </div>
      {events.error && rows?.length ? <ErrorNote error={events.error} /> : null}

      {(pageIndex > 0 || (rows?.length ?? 0) > 0) && (
        <nav className="activity-pager" aria-label="Activity pages">
          <p className="activity-pager-range muted" aria-live="polite">
            {rows?.length ? (
              <>
                Showing <strong>{firstRow.toLocaleString()}</strong>–
                <strong>{(firstRow + rows.length - 1).toLocaleString()}</strong>
                {nextBefore ? "" : " (the oldest)"}
              </>
            ) : (
              "Nothing on this page"
            )}
          </p>
          <div className="activity-pager-size">
            <label htmlFor="activity-size" className="muted">
              Rows per page
            </label>
            <Select
              id="activity-size"
              options={ACTIVITY_PAGE_SIZES.map((n) => ({
                value: String(n),
                label: String(n),
              }))}
              value={String(size)}
              onChange={(event) =>
                setFilter({
                  size:
                    event.target.value === String(ACTIVITY_PAGE_SIZES[0])
                      ? ""
                      : event.target.value,
                })
              }
            />
          </div>
          <div className="activity-pager-buttons">
            <Button
              variant="secondary"
              size="sm"
              icon="chevron-left"
              disabled={pageIndex === 0 || turning}
              onClick={() => goTo(cursors.slice(0, -1))}
            >
              Previous
            </Button>
            <span className="activity-pager-page">Page {pageIndex + 1}</span>
            <Button
              variant="secondary"
              size="sm"
              iconEnd="chevron-right"
              disabled={!nextBefore || turning}
              pending={turning}
              pendingLabel="Loading…"
              onClick={() => nextBefore && goTo([...cursors, nextBefore])}
            >
              Next
            </Button>
          </div>
        </nav>
      )}

      <EventDrawer event={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// ----------------------------------------------------------------- detail --

const META_LABELS: Record<string, string> = {
  title: "Name",
  source: "Copied from",
  version: "Version",
  count: "Responses",
  contacts: "Contacts",
  responses: "Responses",
  kind: "Export",
  sections: "Sections",
  added: "Roles added",
  removed: "Roles removed",
  fromTemplate: "From a template",
  roles: "Roles",
  invited: "Invitation sent",
  passwordSet: "Password set by an admin",
};

function metaValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    const list = value.map((v) =>
      key === "sections" && typeof v === "string"
        ? (SETTINGS_SECTIONS[v] ?? v)
        : String(v),
    );
    return list.length ? list.join(", ") : "None";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "kind" && typeof value === "string")
    return EXPORT_KINDS[value] ?? value;
  if (typeof value === "number") return value.toLocaleString();
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const TARGET_KINDS: Record<string, string> = {
  user: "Person",
  form: "Form",
  role: "Role",
  template: "Template",
  theme: "Theme",
};

function EventDrawer({
  event,
  onClose,
}: {
  event: ActivityRow | null;
  onClose: () => void;
}) {
  const line = event ? describe(event) : null;
  const [kind, id] = splitTarget(event?.target ?? null);
  const meta = Object.entries(event?.meta ?? {});
  return (
    <Drawer
      open={event !== null}
      onClose={onClose}
      title="Event details"
      description={event ? when(event.createdAt) : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {event && line && (
        <div className="activity-drawer-body">
          <p className="activity-drawer-title">
            <span className="list-row-icon" data-tone={line.tone}>
              <Icon name={line.icon} size={16} />
            </span>
            <span>{line.what}</span>
          </p>
          <DefinitionList
            items={[
              {
                label: "By",
                value: event.actor
                  ? event.actor.name
                  : "The system (no one was signed in)",
              },
              {
                label: "Kind",
                value: event.category
                  ? ACTIVITY_CATEGORIES[event.category].label
                  : "Other",
              },
              ...(kind
                ? [
                    {
                      label: TARGET_KINDS[kind] ?? "On",
                      value:
                        event.targetName ??
                        (text(event.meta?.title)
                          ? `${text(event.meta?.title)} (deleted)`
                          : kind === "user"
                            ? `User #${id}`
                            : "No longer exists"),
                    },
                  ]
                : []),
              ...meta
                .filter(
                  ([key]) => !(key === "title" && kind && event.targetName),
                )
                .map(([key, value]) => ({
                  label: META_LABELS[key] ?? key,
                  value: metaValue(key, value),
                })),
              {
                label: "When",
                value: (
                  <time dateTime={event.createdAt}>
                    {when(event.createdAt)} ({ago(event.createdAt)})
                  </time>
                ),
              },
              { label: "Action", value: <code>{event.action}</code> },
              { label: "Event number", value: <code>{event.id}</code> },
            ]}
          />
          {kind === "form" && event.targetName && id && (
            <Link
              to="/forms/$formId"
              params={{ formId: id }}
              className="button button-secondary button-md"
              onClick={onClose}
            >
              Open the form
            </Link>
          )}
        </div>
      )}
    </Drawer>
  );
}

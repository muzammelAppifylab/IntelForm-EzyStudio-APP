import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {type FormEvent, useEffect, useRef, useState} from 'react';

import type {AdminUser} from '../../lib/types';
import {api, read} from '../api';
import {AddUserDrawer} from './add-user';
import {Pager, type PageTarget} from '../intelform/lib/Pager';
import {formatNumber} from '../intelform/responses/format';
import {rolesQuery, usersQuery} from '../queries';
import {ago, useMe, when} from '../shared';
import {
  Badge,
  Button,
  Card,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  ErrorNote,
  LoadingBlock,
  Menu,
  Notice,
  type MenuItem,
  PageHeader,
  Person,
  RadioGroup,
  SearchInput,
  SegmentedControl,
  StatusBadge,
  useConfirm,
  useToast,
} from '../ui';

type StatusFilter = '' | 'active' | 'suspended';

const STATUS_FILTERS: {value: StatusFilter; label: string}[] = [
  {value: '', label: 'All'},
  {value: 'active', label: 'Active'},
  {value: 'suspended', label: 'Suspended'},
];

/**
 * `/users` (site:user:read): every account, newest first, 25 a page with the dashboard's pager
 * (keyset: the admin API sends only the next page's start and no total, so there is no last page
 * or page-size choice; Previous and First reuse the starts already walked).
 * Find one by its exact email. Actions need site:user:update; the server
 * refuses anything that would act on someone with more access than you.
 */
export function Users() {
  const me = useMe();
  const abilities = me.data?.abilities;
  const viewerId = me.data?.viewer.id;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [filter, setFilter] = useState<{email: string; status: StatusFilter}>({
    email: '',
    status: '',
  });
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [adding, setAdding] = useState(false);

  // befores[i] is where page i + 1 starts ('' = the newest). A new filter starts over.
  const [befores, setBefores] = useState<string[]>(['']);
  const [via, setVia] = useState<PageTarget | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const filterSig = JSON.stringify(filter);
  const [seenSig, setSeenSig] = useState(filterSig);
  if (filterSig !== seenSig) {
    setSeenSig(filterSig);
    setBefores(['']);
  }
  const page = befores.length;
  const users = useQuery(usersQuery(filter, befores.at(-1)));
  // A page that came back empty (people removed meanwhile): back to page 1.
  const emptyLater = !!users.data && !users.isPlaceholderData && page > 1 && users.data.users.length === 0;
  useEffect(() => {
    if (emptyLater) setBefores(['']);
  }, [emptyLater]);
  const nextBefore = users.data?.nextBefore;
  const go = (to: PageTarget) => {
    if (to === 'first') setBefores(['']);
    else if (to === 'prev') setBefores(b => (b.length > 1 ? b.slice(0, -1) : b));
    else if (to === 'next') {
      if (!nextBefore) return;
      setBefores(b => [...b, String(nextBefore)]);
    } else return;
    setVia(to);
    // Back to the top of the table when the pager was clicked below it.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({block: 'start'});
  };
  // Role names for the badges; only people who may see roles can read them.
  const roles = useQuery({...rolesQuery, enabled: Boolean(abilities?.manageRoles)});
  const roleNames = new Map(roles.data?.roles.map(role => [role.slug, role.name]));
  const refresh = () => queryClient.invalidateQueries({queryKey: ['users']});

  const setUserStatus = useMutation({
    mutationFn: ({id, status}: {id: number; status: 'active' | 'suspended'}) =>
      read(api.admin.users[':id'].$patch({param: {id: String(id)}, json: {status}})),
    onSuccess: refresh,
  });
  const endSessions = useMutation({
    mutationFn: (id: number) =>
      read(api.admin.users[':id'].sessions.revoke.$post({param: {id: String(id)}})),
  });
  // Lost phone and recovery codes: the user sets two-step sign-in up again on their next sign-in.
  const disableTwoFactor = useMutation({
    mutationFn: (id: number) =>
      read(api.admin.users[':id']['two-factor'].disable.$post({param: {id: String(id)}})),
    onSuccess: refresh,
  });
  // A fresh "choose your password" link for someone who has not joined yet.
  const resendInvite = useMutation({
    mutationFn: (id: number) =>
      read<{ok: true; inviteMinutes: number}>(api.team.users[':id'].invite.$post({param: {id: String(id)}})),
  });
  const busyId =
    (resendInvite.isPending && resendInvite.variables) ||
    (setUserStatus.isPending && setUserStatus.variables?.id) ||
    (endSessions.isPending && endSessions.variables) ||
    (disableTwoFactor.isPending && disableTwoFactor.variables) ||
    null;
  const rows = users.data?.users;
  const pageSize = 25;
  const fromRow = rows?.length ? (page - 1) * pageSize + 1 : 0;
  const toRow = (page - 1) * pageSize + (rows?.length ?? 0);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setFilter(current => ({...current, email: email.trim()}));
  };

  const askEndSessions = async (user: AdminUser) => {
    const done = await confirm({
      title: `Sign ${user.name} out everywhere?`,
      body: 'Every device they are signed in on is signed out. They can sign in again.',
      confirmLabel: 'End sessions',
      pendingLabel: 'Ending…',
      tone: 'primary',
      action: () => endSessions.mutateAsync(user.id),
    });
    if (done) toast.success(`${user.name} is signed out everywhere.`);
  };

  const askDisableTwoFactor = async (user: AdminUser) => {
    const done = await confirm({
      title: `Turn off two-step sign-in for ${user.name}?`,
      body: 'For someone who lost their phone and their recovery codes. They sign in with their password or an emailed code, then can set it up again.',
      confirmLabel: 'Turn it off',
      pendingLabel: 'Turning off…',
      tone: 'danger',
      action: () => disableTwoFactor.mutateAsync(user.id),
    });
    if (done) toast.success(`Two-step sign-in is off for ${user.name}.`);
  };

  const sendInvite = (user: AdminUser) =>
    resendInvite.mutate(user.id, {
      onSuccess: ({inviteMinutes}) =>
        toast.success(`Invite sent to ${user.name}. The link works for ${inviteMinutes} minutes.`),
      onError: error => toast.danger(error.message),
    });

  const askStatus = async (user: AdminUser) => {
    const suspend = user.status === 'active';
    const done = await confirm(
      suspend
        ? {
            title: `Suspend ${user.name}?`,
            body: 'They are signed out at once and cannot sign in until you reactivate them.',
            confirmLabel: 'Suspend',
            pendingLabel: 'Suspending…',
            tone: 'danger',
            action: () => setUserStatus.mutateAsync({id: user.id, status: 'suspended'}),
          }
        : {
            title: `Reactivate ${user.name}?`,
            body: 'They can sign in again with their usual details.',
            confirmLabel: 'Reactivate',
            pendingLabel: 'Reactivating…',
            tone: 'primary',
            action: () => setUserStatus.mutateAsync({id: user.id, status: 'active'}),
          }
    );
    if (done)
      toast.success(
        suspend ? `${user.name} is suspended.` : `${user.name} can sign in again.`
      );
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'person',
      header: 'User',
      cell: user => (
        <span className="users-person">
          <Person name={user.name} detail={user.platformOwner ? 'Comes from the dashboard' : user.email} />
          {!user.emailVerified && !user.platformOwner && (
            <Badge tone="warning">{user.lastLoginAt ? 'Unconfirmed' : 'Invite pending'}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Role',
      cell: user =>
        user.roles.length ? (
          <span className="badges">
            {user.roles.map(slug => (
              <Badge key={slug} tone={slug === 'owner' ? 'brand' : 'neutral'}>
                {roleNames.get(slug) ?? slug}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="muted">None</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 'shrink',
      cell: user =>
        user.status === 'suspended' ? (
          <StatusBadge tone="danger">Suspended</StatusBadge>
        ) : (
          <StatusBadge tone="success">Active</StatusBadge>
        ),
    },
    {
      key: 'last',
      header: 'Last sign-in',
      width: 'shrink',
      cell: user =>
        user.lastLoginAt ? (
          <time
            className="muted"
            dateTime={user.lastLoginAt}
            title={when(user.lastLoginAt)}>
            {ago(user.lastLoginAt)}
          </time>
        ) : (
          <span className="muted">Never</span>
        ),
    },
  ];

  if (abilities?.updateUsers) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: user => {
        if (user.platformOwner) return null;
        const self = user.id === viewerId;
        const items: MenuItem[] = [];
        if (abilities.manageRoles)
          items.push({
            label: 'Change role',
            icon: 'shield',
            onSelect: () => setEditing(user),
          });
        if (abilities.inviteUsers && !user.emailVerified && !self && user.status === 'active')
          items.push({
            label: 'Resend invite',
            icon: 'mail',
            onSelect: () => sendInvite(user),
          });
        items.push({
          label: 'End sessions',
          icon: 'log-out',
          onSelect: () => void askEndSessions(user),
        });
        if (user.twoFactor && !self)
          items.push({
            label: 'Turn off two-step sign-in',
            icon: 'lock',
            onSelect: () => void askDisableTwoFactor(user),
          });
        if (!self) {
          items.push('separator');
          items.push(
            user.status === 'active'
              ? {
                  label: 'Suspend',
                  icon: 'ban',
                  danger: true,
                  onSelect: () => void askStatus(user),
                }
              : {
                  label: 'Reactivate',
                  icon: 'refresh',
                  onSelect: () => void askStatus(user),
                }
          );
        }
        return (
          <Menu
            label={`Actions for ${user.name}`}
            items={items}
            disabled={busyId === user.id}
          />
        );
      },
    });
  }

  const filtered = Boolean(filter.email || filter.status);

  return (
    <div className="app-page screen-users">
      <PageHeader
        title="Users"
        actions={
          abilities?.inviteUsers && (
            <Button icon="user-plus" onClick={() => setAdding(true)}>
              Add user
            </Button>
          )
        }
      />

      <div className="toolbar">
        <form className="users-search" role="search" onSubmit={search} noValidate>
          <SearchInput
            label="Find a user by their exact email"
            placeholder="Exact email, then Enter"
            value={email}
            maxLength={254}
            autoComplete="off"
            onChange={event => {
              setEmail(event.target.value);
              // The box's clear button: show everyone again.
              if (!event.target.value && filter.email)
                setFilter(current => ({...current, email: ''}));
            }}
          />
        </form>
        <SegmentedControl
          label="Status"
          options={STATUS_FILTERS}
          value={filter.status}
          onChange={status => setFilter(current => ({...current, status}))}
        />
      </div>

      <Card flush>
        <div ref={topRef} className={users.isPlaceholderData ? 'list-stale' : undefined} aria-busy={users.isFetching || undefined}>
          <DataTable
            caption="Users"
            columns={columns}
            rows={rows}
            rowKey={user => user.id}
            loading={users.isPending}
            error={users.error}
            busyKey={busyId}
            empty={
              filtered ? (
                <EmptyState
                  icon="search"
                  title={filter.email ? 'No user has that email' : 'No users match'}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEmail('');
                        setFilter({email: '', status: ''});
                      }}>
                      Show everyone
                    </Button>
                  }>
                  {filter.email
                    ? 'Check the spelling: the search needs the whole address.'
                    : 'Try another status.'}
                </EmptyState>
              ) : (
                <EmptyState
                  icon="users"
                  title="No users yet"
                  action={
                    abilities?.inviteUsers && <Button onClick={() => setAdding(true)}>Add user</Button>
                  }>
                  People show here once they sign up or you add them.
                </EmptyState>
              )
            }
          />
        </div>
      </Card>
      {users.error && rows?.length ? <ErrorNote error={users.error} /> : null}
      {rows && rows.length > 0 ? (
        <div className="list-foot">
          <p className="muted list-count" aria-live="polite">
            {page === 1 && !nextBefore ? (
              `${formatNumber(rows.length)} ${rows.length === 1 ? 'user' : 'users'}`
            ) : (
              <>
                Showing <strong>{formatNumber(fromRow)}–{formatNumber(toRow)}</strong> {filtered ? 'matching users' : 'users'}
              </>
            )}
          </p>
          {(nextBefore || page > 1) && <Pager
            page={page}
            lastPage={nextBefore ? null : page}
            lastPageCapped={false}
            hasPrev={page > 1}
            hasNext={!!nextBefore}
            size={pageSize}
            pending={users.isPlaceholderData ? via : null}
            onGo={go}
          />}
        </div>
      ) : null}

      {adding && (
        <AddUserDrawer
          onClose={() => setAdding(false)}
          onAdded={({user, invited, inviteMinutes}) => {
            setAdding(false);
            toast.success(
              invited
                ? `${user.name} is added. We emailed them an invite (the link works for ${inviteMinutes} minutes).`
                : `${user.name} is added. Share their password with them.`
            );
            void refresh();
            void queryClient.invalidateQueries({queryKey: ['roles']});
          }}
        />
      )}

      {editing && (
        <RoleEditor
          key={editing.id}
          user={editing}
          self={editing.id === viewerId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success(`Role saved for ${editing.name}.`);
            setEditing(null);
            void refresh();
            if (editing.id === viewerId)
              void queryClient.invalidateQueries({queryKey: ['me']});
          }}
        />
      )}
    </div>
  );
}

/**
 * Pick a user's ONE role in a drawer (people hold a single role). Someone who holds
 * several from before starts on their main one (anything but `member`); saving replaces
 * them all. The server refuses a role you could not grant yourself.
 */
function RoleEditor({
  user,
  self,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  self: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const roles = useQuery(rolesQuery);
  const [picked, setPicked] = useState<string | null>(
    user.roles.find(slug => slug !== 'member') ?? user.roles[0] ?? null
  );
  const save = useMutation({
    mutationFn: (role: string) =>
      read<{user: AdminUser}>(
        api.admin.users[':id'].roles.$put({
          param: {id: String(user.id)},
          json: {roles: [role]},
        })
      ),
    onSuccess: onSaved,
  });
  const changed = picked !== null && !(user.roles.length === 1 && user.roles[0] === picked);

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={`Role for ${user.name}`}
      description={
        self
          ? 'This is your own role. Picking another changes what you can do right away.'
          : user.email
      }
      onSubmit={event => {
        event.preventDefault();
        if (changed && picked) save.mutate(picked);
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            pending={save.isPending}
            pendingLabel="Saving…"
            disabled={!changed || roles.isPending}>
            Save role
          </Button>
        </>
      }>
      <div className="form-stack">
        {roles.error && <ErrorNote error={roles.error} />}
        {user.roles.length > 1 && (
          <Notice tone="info">
            They have {user.roles.length} roles now. Saving keeps only the one picked here.
          </Notice>
        )}
        {roles.isPending ? (
          <LoadingBlock rows={3} />
        ) : (
          <RadioGroup
            legend="Role"
            name="role"
            value={picked}
            onChange={setPicked}
            disabled={save.isPending}
            options={(roles.data?.roles ?? [])
              // `owner` comes only from the dashboard: never offered here.
              .filter(role => role.slug !== 'owner')
              .map(role => ({
                value: role.slug,
                label: role.name,
                description: role.description ?? undefined,
              }))}
          />
        )}
        {save.error && <ErrorNote error={save.error} />}
      </div>
    </Drawer>
  );
}

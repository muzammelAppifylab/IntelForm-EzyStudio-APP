import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Fragment, useState} from 'react';

import {grants} from '../../platform/auth/codenames';
import {rules} from '../../lib/rules';
import type {PermissionRow, RoleRow} from '../../lib/types';
import {CATALOGUE} from '../../server/permissions';
import {api, ApiError, read} from '../api';
import {permissionsQuery, rolesQuery} from '../queries';
import {useMe} from '../shared';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  Icon,
  LoadingBlock,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  ProgressBar,
  Tabs,
  useConfirm,
  useForm,
  useToast,
} from '../ui';

/** The role form's rules: the SAME limits `src/platform/auth/admin.ts` enforces. */
const ROLE_RULES = {
  slug: [
    rules.required('Enter a short id, like "editor".'),
    rules.pattern(
      /^[a-z][a-z0-9-]{1,47}$/,
      'Use 2 to 48 lowercase letters, digits or dashes, starting with a letter.'
    ),
  ],
  name: [rules.required('Enter a name.'), rules.maxLength(80)],
  description: [rules.maxLength(255)],
};

const OWNER = 'owner';

/** Codenames this site still ships (a permission left in the database by older code is hidden). */
const KNOWN = new Set<string>(Object.values(CATALOGUE).map(entry => entry.codename));
const isWildcard = (codename: string) => codename === '*' || codename.endsWith(':*');

type View = 'roles' | 'compare';

/** What a role lets people do, against the site's concrete permissions (wildcards resolved). */
function accessOf(role: RoleRow, concrete: PermissionRow[]) {
  const held = new Set(role.permissions);
  const granted = concrete.filter(p => grants(held, p.codename));
  return {granted, everything: held.has('*') || role.slug === OWNER};
}

const kindOf = (role: RoleRow) =>
  role.slug === OWNER ? (
    <Badge tone="brand" icon="lock">
      Fixed
    </Badge>
  ) : role.isSystem ? (
    <Badge>Built-in</Badge>
  ) : (
    <Badge tone="info">Custom</Badge>
  );

const peopleLabel = (members: RoleRow['members']) =>
  !members
    ? '—'
    : members.count === 0
      ? 'Nobody yet'
      : `${members.count}${members.more ? '+' : ''} ${members.count === 1 && !members.more ? 'person' : 'people'}`;

/**
 * `/roles` (site:role:read): what each role allows. Two views: the roles as a table (open
 * one to see its permissions), and every permission compared across roles. Editing needs
 * site:role:update, and you can only grant permissions you hold yourself. `owner` is
 * fixed; built-in roles cannot be deleted.
 */
export function Roles() {
  const me = useMe();
  const canEdit = Boolean(me.data?.abilities.editRoles);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<View>('roles');
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [viewing, setViewing] = useState<RoleRow | null>(null);

  const roles = useQuery(rolesQuery);
  const catalogue = useQuery(permissionsQuery);
  const remove = useMutation({
    mutationFn: (slug: string) => read(api.admin.roles[':slug'].$delete({param: {slug}})),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['roles']}),
  });
  const known = (catalogue.data?.permissions ?? []).filter(p => KNOWN.has(p.codename));
  const concrete = known.filter(p => !isWildcard(p.codename));
  const list = roles.data?.roles;
  const customCount = list?.filter(role => !role.isSystem).length ?? 0;

  const askDelete = async (role: RoleRow) => {
    const done = await confirm({
      title: `Delete the “${role.name}” role?`,
      body: 'People who have it lose what it allowed. This cannot be undone.',
      confirmLabel: 'Delete role',
      pendingLabel: 'Deleting…',
      action: () => remove.mutateAsync(role.slug),
    });
    if (done) toast.success(`The “${role.name}” role is deleted.`);
  };

  const columns: Column<RoleRow>[] = [
    {
      key: 'role',
      header: 'Role',
      cell: role => (
        <div className="role-cell">
          <span className="role-cell-title">
            <button type="button" className="role-name" onClick={() => setViewing(role)}>
              {role.name}
            </button>
            {kindOf(role)}
          </span>
          {role.description && <span className="role-cell-description">{role.description}</span>}
        </div>
      ),
    },
    {
      key: 'people',
      header: 'People',
      width: 'shrink',
      cell: role => (
        <span className="role-people">
          <Icon name="users" size={14} />
          {peopleLabel(role.members)}
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Access',
      cell: role => {
        if (catalogue.isPending) return <span className="muted">…</span>;
        const {granted, everything} = accessOf(role, concrete);
        const total = concrete.length || 1;
        return (
          <div className="role-access">
            <span className="role-access-label">
              {everything
                ? 'Everything'
                : granted.length === 0
                  ? 'Sign in only'
                  : `${granted.length} of ${concrete.length} permissions`}
            </span>
            <ProgressBar
              value={everything ? total : granted.length}
              max={total}
              label={`${role.name}: ${everything ? 'every' : granted.length} permission${granted.length === 1 ? '' : 's'}`}
            />
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: role => {
        const fixed = role.slug === OWNER;
        const items: MenuItem[] = [{label: 'View permissions', icon: 'eye', onSelect: () => setViewing(role)}];
        if (canEdit && !fixed) {
          items.push({label: 'Edit', icon: 'pencil', onSelect: () => setEditing(role)});
          if (!role.isSystem) {
            items.push('separator', {label: 'Delete', icon: 'trash', danger: true, onSelect: () => void askDelete(role)});
          }
        }
        return (
          <Menu
            label={`Actions for the ${role.name} role`}
            items={items}
            disabled={remove.isPending && remove.variables === role.slug}
          />
        );
      },
    },
  ];

  return (
    <div className="app-page screen-roles">
      <PageHeader
        title="Roles"
        description="Each person has one role, and a role decides what they can see and change. Give roles to people on the Users screen."
        actions={
          <Button
            icon="plus"
            disabled={!canEdit}
            title={canEdit ? undefined : 'Your role does not include “Change roles”'}
            onClick={() => setEditing('new')}>
            New role
          </Button>
        }
      />

      {me.data && !canEdit && (
        <Notice tone="info" title="You can view roles, not change them">
          Creating, editing and deleting roles needs the “Change roles” permission. Admins and the
          site owner have it: ask one of them to change your role on the Users screen.
        </Notice>
      )}

      <Tabs<View>
        label="Role views"
        value={view}
        onChange={setView}
        items={[
          {value: 'roles', label: 'Roles', count: list?.length},
          {value: 'compare', label: 'Compare permissions'},
        ]}>
        {view === 'roles' ? (
          <div className="roles-stack">
            <Card flush>
              <DataTable
                caption="Roles"
                columns={columns}
                rows={list}
                rowKey={role => role.slug}
                loading={roles.isPending}
                error={roles.error}
                busyKey={remove.isPending ? remove.variables : null}
                empty={
                  <EmptyState
                    icon="shield"
                    title="No roles yet"
                    action={canEdit && <Button onClick={() => setEditing('new')}>New role</Button>}>
                    A role groups permissions you can give to people.
                  </EmptyState>
                }
              />
            </Card>
            {list && customCount === 0 && canEdit && (
              <Notice
                tone="info"
                title="Need something in between?"
                action={
                  <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
                    Create a custom role
                  </Button>
                }>
                Make a role with exactly the permissions a job needs, like “Response reviewer”.
              </Notice>
            )}
          </div>
        ) : (
          <PermissionMatrix
            roles={list}
            permissions={known}
            loading={roles.isPending || catalogue.isPending}
            error={roles.error ?? catalogue.error}
            onOpen={setViewing}
          />
        )}
      </Tabs>

      {viewing && (
        <RoleDetails
          role={viewing}
          permissions={known}
          canEdit={canEdit}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      )}

      {editing !== null && (
        <RoleForm
          key={editing === 'new' ? 'new' : editing.slug}
          role={editing === 'new' ? null : editing}
          catalogue={known}
          catalogueError={catalogue.error}
          catalogueLoading={catalogue.isPending}
          onClose={() => setEditing(null)}
          onSaved={name => {
            toast.success(
              editing === 'new' ? `The “${name}” role is created.` : `The “${name}” role is saved.`
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** The permissions grouped as the catalogue groups them, wildcards ("every user permission") left out. */
function groupsOf(permissions: PermissionRow[]) {
  const groups = new Map<string, PermissionRow[]>();
  for (const permission of permissions) {
    if (isWildcard(permission.codename)) continue;
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission]);
  }
  return [...groups];
}

/** One role's permissions, in a drawer: what it allows (ticked) and what it doesn't. */
function RoleDetails({
  role,
  permissions,
  canEdit,
  onClose,
  onEdit,
}: {
  role: RoleRow;
  permissions: PermissionRow[];
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const held = new Set(role.permissions);
  const fixed = role.slug === OWNER;
  return (
    <Drawer
      open
      onClose={onClose}
      title={role.name}
      description={role.description ?? undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canEdit && !fixed && (
            <Button icon="pencil" onClick={onEdit}>
              Edit role
            </Button>
          )}
        </>
      }>
      <div className="form-stack">
        <div className="role-facts">
          {kindOf(role)}
          <code>{role.slug}</code>
          <span className="role-people">
            <Icon name="users" size={14} />
            {peopleLabel(role.members)}
          </span>
        </div>
        {fixed && <Notice tone="info">The owner can do everything, always. This role cannot be changed.</Notice>}
        {groupsOf(permissions).map(([group, items]) => (
          <section className="role-perm-group" key={group} aria-label={group}>
            <h3>{group}</h3>
            <ul className="role-perm-list">
              {items.map(permission => {
                const on = grants(held, permission.codename);
                return (
                  <li key={permission.codename} data-on={on ? '' : undefined}>
                    <span className="role-perm-mark" aria-hidden="true">
                      <Icon name={on ? 'check' : 'x'} size={14} />
                    </span>
                    <span>
                      <span className="role-perm-title">
                        {permission.title}
                        <span className="visually-hidden">{on ? ': allowed' : ': not allowed'}</span>
                      </span>
                      {permission.description && <span className="role-perm-description">{permission.description}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Drawer>
  );
}

/** Every permission (rows, by group) against every role (columns). */
function PermissionMatrix({
  roles,
  permissions,
  loading,
  error,
  onOpen,
}: {
  roles: RoleRow[] | undefined;
  permissions: PermissionRow[];
  loading: boolean;
  error: Error | null;
  onOpen: (role: RoleRow) => void;
}) {
  if (error) return <ErrorNote error={error} />;
  if (loading || !roles) {
    return (
      <Card>
        <LoadingBlock rows={5} />
      </Card>
    );
  }
  const held = new Map(roles.map(role => [role.slug, new Set(role.permissions)]));
  return (
    <Card flush>
      <div className="table-wrap role-matrix-wrap">
        <table className="role-matrix">
          <caption className="visually-hidden">Permissions by role</caption>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {roles.map(role => (
                <th scope="col" key={role.slug}>
                  <button type="button" className="role-name" onClick={() => onOpen(role)}>
                    {role.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupsOf(permissions).map(([group, items]) => (
              <Fragment key={group}>
                <tr className="role-matrix-group">
                  <th scope="colgroup" colSpan={roles.length + 1}>
                    {group}
                  </th>
                </tr>
                {items.map(permission => (
                  <tr key={permission.codename}>
                    <th scope="row" title={permission.description ?? undefined}>
                      {permission.title}
                    </th>
                    {roles.map(role => {
                      const on = grants(held.get(role.slug)!, permission.codename);
                      return (
                        <td key={role.slug} data-on={on ? '' : undefined}>
                          {on ? <Icon name="check" size={16} /> : <span aria-hidden="true">—</span>}
                          <span className="visually-hidden">{on ? 'Allowed' : 'Not allowed'}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RoleForm({
  role,
  catalogue,
  catalogueError,
  catalogueLoading,
  onClose,
  onSaved,
}: {
  role: RoleRow | null;
  catalogue: PermissionRow[];
  catalogueError: Error | null;
  catalogueLoading: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm(
    {
      slug: role?.slug ?? '',
      name: role?.name ?? '',
      description: role?.description ?? '',
    },
    role ? {name: ROLE_RULES.name, description: ROLE_RULES.description} : ROLE_RULES
  );
  const [picked, setPicked] = useState<string[]>(role?.permissions ?? []);
  const save = useMutation({
    mutationFn: (values: {slug: string; name: string; description: string}) =>
      role
        ? read(
            api.admin.roles[':slug'].$patch({
              param: {slug: role.slug},
              json: {
                name: values.name,
                description: values.description,
                permissions: picked,
              },
            })
          )
        : read(api.admin.roles.$post({json: {...values, permissions: picked}})),
    onSuccess: async (_data, values) => {
      await queryClient.invalidateQueries({queryKey: ['roles']});
      onSaved(values.name.trim());
    },
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  const groups = [...new Set(catalogue.map(p => p.group))];
  const fieldErrors = save.error instanceof ApiError ? save.error.fields : {};
  const onField = ['slug', 'name', 'description'].some(name => fieldErrors[name]);

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={role ? `Edit ${role.name}` : 'New role'}
      description="You can only give a role permissions you hold yourself."
      onSubmit={form.submit(values => save.mutate(values))}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Saving…">
            {role ? 'Save changes' : 'Create role'}
          </Button>
        </>
      }>
      <div className="form-stack">
        {!role && (
          <Field
            id="f-slug"
            label="Id"
            hint="Lowercase, used in code, like “editor”. It cannot change later."
            error={form.error('slug')}>
            <input {...form.field('slug')} autoComplete="off" maxLength={48} />
          </Field>
        )}
        <Field id="f-name" label="Name" error={form.error('name')}>
          <input {...form.field('name')} autoComplete="off" maxLength={80} />
        </Field>
        <Field
          id="f-description"
          label="Description"
          optional
          error={form.error('description')}>
          <textarea {...form.field('description')} rows={2} maxLength={255} />
        </Field>

        {catalogueError && <ErrorNote error={catalogueError} />}
        {catalogueLoading ? (
          <LoadingBlock rows={3} />
        ) : (
          groups.map(group => (
            <fieldset className="checkbox-group" key={group}>
              <legend>{group}</legend>
              {catalogue
                .filter(p => p.group === group)
                .map(permission => (
                  <Checkbox
                    key={permission.codename}
                    label={permission.title}
                    description={permission.description ?? undefined}
                    checked={picked.includes(permission.codename)}
                    disabled={save.isPending}
                    onChange={checked =>
                      setPicked(current =>
                        checked
                          ? [...current, permission.codename]
                          : current.filter(codename => codename !== permission.codename)
                      )
                    }
                  />
                ))}
            </fieldset>
          ))
        )}
        {fieldErrors.permissions && (
          <Notice tone="danger">{fieldErrors.permissions}</Notice>
        )}
        {save.error && !onField && !fieldErrors.permissions && (
          <ErrorNote error={save.error} />
        )}
      </div>
    </Drawer>
  );
}

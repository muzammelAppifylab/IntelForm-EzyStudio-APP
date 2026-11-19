import {useMutation, useQuery} from '@tanstack/react-query';
import {useRef, useState} from 'react';

import {passwordChecks} from '../../lib/password-checks';
import {rules} from '../../lib/rules';
import {api, ApiError, read} from '../api';
import {rolesQuery} from '../queries';
import {
  Button,
  Checkbox,
  Drawer,
  ErrorNote,
  Field,
  LoadingBlock,
  PasswordChecks,
  PasswordInput,
  RadioCards,
  RadioGroup,
  useForm,
} from '../ui';

type Access = 'invite' | 'password';

export type AddedUser = {user: {id: number; name: string}; invited: boolean; inviteMinutes: number};

const OWNER = 'owner';
const MEMBER = 'member';

/**
 * "Add user" (site:user:invite, `src/server/routes/team.ts`): name, email, roles, and how
 * they get in: an emailed invite to choose their own password, or a password set here
 * (with an optional invite email too). The rules mirror the route's validator.
 */
export function AddUserDrawer({onClose, onAdded}: {onClose: () => void; onAdded: (result: AddedUser) => void}) {
  const roles = useQuery(rolesQuery);
  const [access, setAccess] = useState<Access>('invite');
  const [alsoEmail, setAlsoEmail] = useState(false);
  // One role per person; new people start as plain members, like a sign-up.
  const [role, setRole] = useState<string>(MEMBER);
  // The password rule compares against the email being typed.
  const emailNow = useRef('');
  const form = useForm(
    {name: '', email: '', password: ''},
    {
      name: [rules.required('Enter their name.'), rules.maxLength(80)],
      email: [rules.required('Enter their email address.'), rules.email(), rules.maxLength(254)],
      password: access === 'password' ? [rules.passwordMeetsRules(() => emailNow.current)] : [],
    }
  );
  const save = useMutation({
    mutationFn: (values: {name: string; email: string; password: string}) =>
      read<AddedUser>(
        api.team.users.$post({
          json: {
            name: values.name.trim(),
            email: values.email.trim(),
            roles: [role],
            invite: access === 'invite' || alsoEmail,
            password: access === 'password' ? values.password : null,
          },
        })
      ),
    onSuccess: onAdded,
    onError: err => err instanceof ApiError && form.setServerErrors(err.fields),
  });
  emailNow.current = form.values.email;
  const fieldErrors = save.error instanceof ApiError ? save.error.fields : {};
  const onField = ['name', 'email', 'password', 'roles'].some(name => fieldErrors[name]);
  const choosable = roles.data?.roles.filter(role => role.slug !== OWNER) ?? [];
  const checks = passwordChecks(form.values.password, form.values.email);

  return (
    <Drawer
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title="Add a user"
      description="They get an account with the role you pick. You can change it later."
      onSubmit={form.submit(values => save.mutate(values))}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending} pendingLabel="Adding…">
            {access === 'invite' ? 'Add and send invite' : 'Add user'}
          </Button>
        </>
      }>
      <div className="form-stack">
        <Field id={form.id('name')} label="Name" error={form.error('name')}>
          <input {...form.field('name')} autoComplete="off" maxLength={80} placeholder="Sam Rivera" />
        </Field>
        <Field id={form.id('email')} label="Email" error={form.error('email')}>
          <input
            {...form.field('email')}
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            placeholder="sam@example.com"
          />
        </Field>

        {roles.error && <ErrorNote error={roles.error} />}
        {roles.isPending ? (
          <LoadingBlock rows={3} />
        ) : (
          <RadioGroup
            legend="Role"
            name="role"
            value={role}
            onChange={setRole}
            disabled={save.isPending}
            error={fieldErrors.roles}
            options={choosable.map(option => ({
              value: option.slug,
              label: option.name,
              description: option.description ?? undefined,
            }))}
          />
        )}

        <RadioCards<Access>
          legend="How they get in"
          name="access"
          value={access}
          onChange={setAccess}
          columns={1}
          options={[
            {
              value: 'invite',
              title: 'Email them an invite',
              description: 'They get a link to choose their own password. Best for most people.',
            },
            {
              value: 'password',
              title: 'Set a password for them',
              description: 'You share it with them yourself. On their first sign-in they confirm their email with a code.',
            },
          ]}
        />

        {access === 'password' && (
          <>
            <Field id={form.id('password')} label="Password" error={form.error('password')}>
              <PasswordInput
                {...form.field('password')}
                autoComplete="new-password"
                maxLength={128}
                aria-describedby={`${form.error('password') ? `${form.id('password')}-error ` : ''}${form.id('password')}-checks`}
              />
            </Field>
            <PasswordChecks id={`${form.id('password')}-checks`} checks={checks} tried={Boolean(form.error('password'))} />
            <Checkbox
              label="Also email them an invite"
              description="A link to sign in and choose their own password, if they prefer."
              checked={alsoEmail}
              disabled={save.isPending}
              onChange={setAlsoEmail}
            />
          </>
        )}

        {save.error && !onField && <ErrorNote error={save.error} />}
      </div>
    </Drawer>
  );
}

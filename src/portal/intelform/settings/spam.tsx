import {useInfiniteQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {type FormEvent, useState} from 'react';

import {
  addBlockInput,
  BLOCK_LENGTHS,
  BLOCKED_VISITORS_API,
  type BlockedVisitor,
  type BlockedVisitorsPage,
  type BlockLength,
} from '../../../lib/intelform/api-spam';
import {DAY_BELOW_HOUR, FORM_LIMITS, SITE_LIMITS, spamSettingsInput, type SpamSettings} from '../../../lib/intelform/spam';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {ago} from '../../shared';
import {
  Badge,
  Button,
  Card,
  type Column,
  DataTable,
  EmptyState,
  Field,
  LoadMore,
  Menu,
  Modal,
  RadioCards,
  useConfirm,
  useToast,
} from '../../ui';
import {api, ApiRequestError, errorMessage} from '../lib/api';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings} from '../queries/app-settings';
import {same, SettingsCard} from './bits';

/**
 * Settings → Spam protection: the site's own ceilings, the limits new forms start with, and the
 * network addresses spam protection has blocked (routes/blocked-visitors.ts). Admins only (the
 * whole Settings screen is), so addresses show in full here.
 */

type Key = keyof SpamSettings;

const SITE_FIELDS: {key: Key; label: string; hint: string}[] = [
  {
    key: 'sitePerMinute',
    label: 'Responses to all forms, per minute',
    hint: `Every form together. From ${SITE_LIMITS.sitePerMinute.min} to ${SITE_LIMITS.sitePerMinute.max.toLocaleString('en')}.`,
  },
  {
    key: 'confirmPerDay',
    label: 'Confirmation emails from all forms, per day',
    hint: `Past this, responses are still saved but get no confirmation email. From ${SITE_LIMITS.confirmPerDay.min} to ${SITE_LIMITS.confirmPerDay.max.toLocaleString('en')}.`,
  },
];

const FORM_FIELDS: {key: Key; label: string}[] = [
  {key: 'spamIpPerHour', label: 'Responses from one network, per hour'},
  {key: 'spamIpPerDay', label: 'Responses from one network, per day'},
  {key: 'spamFormPerMinute', label: 'Responses from everyone, per minute'},
  {key: 'confirmPerHour', label: 'Confirmation emails, per hour'},
];

const RULES = {...FORM_LIMITS, ...SITE_LIMITS};

const toText = (s: SpamSettings) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Record<Key, string>;

function LimitsCard({view}: {view: AppSettingsResponse}) {
  const [text, setText] = useState(() => toText(view.spam));
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const dirty = !same(text, toText(view.spam));

  function submit() {
    const values = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.trim() === '' ? NaN : Number(v)]));
    const spam = errors.validate(spamSettingsInput, values);
    if (!spam) return;
    if ((spam.spamIpPerDay ?? 0) < (spam.spamIpPerHour ?? 0)) return errors.setFieldErrors({spamIpPerDay: DAY_BELOW_HOUR});
    save.mutate(
      {spam},
      {
        onSuccess: next => {
          setText(toText(next.spam));
          toast.success('Spam protection saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  const row = (f: {key: Key; label: string; hint?: string}) => {
    const r = RULES[f.key as keyof typeof RULES];
    const id = `as-spam-${f.key}`;
    return (
      <Field key={f.key} id={id} label={f.label} hint={f.hint ?? `From ${r.min} to ${r.max.toLocaleString('en')}.`} error={errors.fields[f.key]}>
        <input
          {...errors.control(f.key, id, {hint: true})}
          inputMode="numeric"
          value={text[f.key]}
          onChange={e => setText(t => ({...t, [f.key]: e.target.value.replace(/\D/g, '')}))}
        />
      </Field>
    );
  };

  return (
    <SettingsCard
      title="Spam protection"
      description="Hard limits by default, so a bot can’t flood your forms, fill a form’s response limit or send emails through it."
      onSubmit={submit}
      dirty={dirty}
      saving={save.isPending}
      formError={errors.form}>
      <p className="settings-note">
        Schools, offices and cafés often share one network address, so everyone there counts as one visitor. Raise a form’s limits
        before you share it with a class or a team in one place.
      </p>
      <div className="form-grid">{SITE_FIELDS.map(row)}</div>
      <p className="settings-note">
        <strong>New forms start with.</strong> Each form can change these in its own Spam protection settings. Forms you already have
        keep theirs.
      </p>
      <div className="form-grid">{FORM_FIELDS.map(row)}</div>
    </SettingsCard>
  );
}

// ------------------------------------------------------------------ blocked --

const blockedQuery = {
  queryKey: ['intelform', 'blocked-visitors'] as const,
  queryFn: ({pageParam}: {pageParam: string | null}) =>
    api<BlockedVisitorsPage>(`${BLOCKED_VISITORS_API}${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
  initialPageParam: null as string | null,
  getNextPageParam: (last: BlockedVisitorsPage) => last.next,
};

const LENGTH_LABEL: Record<BlockLength, {title: string; description: string}> = {
  hour: {title: '1 hour', description: 'A short pause.'},
  day: {title: '1 day', description: 'Until tomorrow.'},
  week: {title: '7 days', description: 'For a repeat offender.'},
  month: {title: '30 days', description: 'The longest block.'},
};

function AddBlock({open, onClose}: {open: boolean; onClose: () => void}) {
  const [address, setAddress] = useState('');
  const [length, setLength] = useState<BlockLength>('day');
  const errors = useFormErrors();
  const queryClient = useQueryClient();
  const toast = useToast();
  const add = useMutation({
    mutationFn: (input: {address: string; length: BlockLength}) => api(BLOCKED_VISITORS_API, {method: 'POST', body: input}),
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: blockedQuery.queryKey});
      toast.success('Address blocked.');
      setAddress('');
      onClose();
    },
    onError: err => errors.fromError(err),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = errors.validate(addBlockInput, {address, length});
    if (input) add.mutate(input);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!add.isPending}
      title="Block an address"
      description="Responses from this network are refused until the block ends. Its people can still open your forms."
      footer={
        <>
          <Button variant="secondary" disabled={add.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="as-block-form" pending={add.isPending} pendingLabel="Blocking…">
            Block address
          </Button>
        </>
      }>
      <form id="as-block-form" className="form-stack" noValidate onSubmit={submit}>
        <Field id="as-block-address" label="IP address" hint="An IPv4 address, or an IPv6 address (its whole /64 network is blocked)." error={errors.fields.address}>
          <input
            {...errors.control('address', 'as-block-address', {hint: true})}
            value={address}
            placeholder="203.0.113.7"
            autoComplete="off"
            spellCheck={false}
            onChange={e => setAddress(e.target.value)}
          />
        </Field>
        <RadioCards
          legend="How long"
          name="as-block-length"
          value={length}
          columns={2}
          options={BLOCK_LENGTHS.map(value => ({value, ...LENGTH_LABEL[value]}))}
          onChange={setLength}
        />
        {errors.fields.length && <p className="field-error">{errors.fields.length}</p>}
        {errors.form && <p className="field-error">{errors.form}</p>}
      </form>
    </Modal>
  );
}

const STEP_TEXT = (step: number) => (step <= 1 ? 'First block' : step === 2 ? 'Second block' : `Block ${step}`);

function BlockedCard() {
  const blocked = useInfiniteQuery(blockedQuery);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const rows = blocked.data?.pages.flatMap(p => p.blocks);
  const canManage = blocked.data?.pages[0]?.canManage ?? false;
  const unblock = useMutation({
    mutationFn: (id: string) => api(`${BLOCKED_VISITORS_API}/${encodeURIComponent(id)}`, {method: 'DELETE'}),
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: blockedQuery.queryKey});
      toast.success('Address unblocked.');
    },
  });

  const columns: Column<BlockedVisitor>[] = [
    {key: 'address', header: 'Address', cell: b => <span className="cell-title">{b.address ?? 'Unknown address'}</span>},
    {
      key: 'reason',
      header: 'Reason',
      cell: b =>
        b.reason === 'manual' ? (
          <Badge tone="neutral">Blocked by an admin</Badge>
        ) : (
          <span>
            <Badge tone="warning">Kept going over the limits</Badge>
            {b.form && (
              <>
                {' '}
                on{' '}
                <Link to="/forms/$formId/settings" params={{formId: b.form.id}}>
                  {b.form.title}
                </Link>
              </>
            )}
          </span>
        ),
    },
    {key: 'hits', header: 'Refused', width: 'shrink', hideOnMobile: true, cell: b => (b.reason === 'manual' ? '–' : b.hits.toLocaleString())},
    {key: 'step', header: 'Times', width: 'shrink', hideOnMobile: true, cell: b => STEP_TEXT(b.step)},
    {key: 'expires', header: 'Ends', width: 'shrink', cell: b => new Date(b.expiresAt).toLocaleString()},
    {key: 'updated', header: 'Last seen', width: 'shrink', hideOnMobile: true, cell: b => ago(b.updatedAt)},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: b =>
        canManage ? (
          <Menu
            label={`Actions for ${b.address ?? 'this address'}`}
            items={[
              {
                label: 'Unblock',
                icon: 'lock-open',
                onSelect: () =>
                  void confirm({
                    title: `Unblock ${b.address ?? 'this address'}?`,
                    body: 'Responses from this network are accepted again, and its earlier blocks are forgotten.',
                    confirmLabel: 'Unblock',
                    pendingLabel: 'Unblocking…',
                    tone: 'primary',
                    action: () => unblock.mutateAsync(b.id),
                  }),
              },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <Card
      title="Blocked visitors"
      description="Networks that kept going over a form’s limits are blocked for 1 hour, then 24 hours, then 7 days. You can also block one by hand."
      actions={
        canManage ? (
          <Button variant="secondary" size="sm" icon="ban" onClick={() => setAdding(true)}>
            Block an address
          </Button>
        ) : undefined
      }
      flush>
      <DataTable
        caption="Blocked visitors"
        columns={columns}
        rows={rows}
        rowKey={b => b.id}
        loading={blocked.isPending}
        error={blocked.error}
        busyKey={unblock.isPending ? unblock.variables : undefined}
        empty={<EmptyState icon="shield" title="Nobody is blocked">When a network keeps going over a form’s limits, it shows here.</EmptyState>}
      />
      <LoadMore query={blocked} />
      {unblock.isError && !(unblock.error instanceof ApiRequestError && unblock.error.status === 404) && (
        <p className="field-error">{errorMessage(unblock.error)}</p>
      )}
      <AddBlock open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

export function SpamGroup({view}: {view: AppSettingsResponse}) {
  return (
    <div className="form-stack">
      <LimitsCard view={view} />
      <BlockedCard />
    </div>
  );
}

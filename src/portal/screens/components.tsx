import {useState} from 'react';

import {
  Badge,
  BarChart,
  Button,
  Calendar,
  Card,
  Checkbox,
  Collapsible,
  type Column,
  Combobox,
  CommandPalette,
  CopyField,
  DataTable,
  DatePicker,
  DefinitionList,
  Drawer,
  EmptyState,
  Field,
  Icon,
  ICON_NAMES,
  IconButton,
  LoadingBlock,
  Menu,
  Modal,
  Notice,
  NpsScale,
  NpsSummaryBar,
  PageHeader,
  Person,
  Popover,
  ProgressBar,
  RadioCards,
  RadioGroup,
  RatingScale,
  ScrollArea,
  rules,
  SearchInput,
  SegmentedControl,
  Select,
  SettingRow,
  Slider,
  Sparkline,
  Spinner,
  Stat,
  StatCard,
  StatusBadge,
  Switch,
  Tabs,
  ToggleGroup,
  Tooltip,
  useConfirm,
  useForm,
  useToast,
} from '../ui';

/**
 * `/components`: the UI kit on one screen, DEV ONLY (the Preview and
 * `npm run dev`; not in a build, see routes.tsx). Every piece here is
 * imported from `../ui`. Build new screens from these; to change how they
 * look, change the tokens (global.css) or the classes (app.css), not a screen.
 *
 * The rows below are sample data for this page only.
 */
type Sample = {id: number; name: string; email: string; plan: string; status: 'active' | 'trial' | 'overdue'};
const SAMPLE: Sample[] = [
  {id: 1, name: 'Maya Patel', email: 'maya@example.com', plan: 'Pro', status: 'active'},
  {id: 2, name: 'Sam Rivera', email: 'sam@example.com', plan: 'Starter', status: 'trial'},
  {id: 3, name: 'Ava Chen', email: 'ava@example.com', plan: 'Pro', status: 'overdue'},
];
const STATUS_TONES = {active: 'success', trial: 'info', overdue: 'warning'} as const;

export function Components() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'buttons' | 'forms' | 'data' | 'feedback' | 'intelform' | 'icons'>('buttons');

  return (
    <div className="app-page">
      <PageHeader
        title="Components"
        description="The pieces every screen is built from. Only you see this page, and only in the Preview."
        actions={<Button icon="plus">Primary action</Button>}
      />
      <Notice tone="info" title="Import from src/portal/ui">
        <p>
          <code>{"import {Button, Card, DataTable} from '../ui';"}</code> Rules for each piece: docs/agent/ui.md.
        </p>
      </Notice>

      <Tabs
        label="Component groups"
        value={tab}
        onChange={setTab}
        items={[
          {value: 'buttons', label: 'Buttons & overlays'},
          {value: 'forms', label: 'Forms'},
          {value: 'data', label: 'Data'},
          {value: 'feedback', label: 'States'},
          {value: 'intelform', label: 'IntelForm'},
          {value: 'icons', label: 'Icons & colours', count: ICON_NAMES.length},
        ]}>
        {tab === 'buttons' && <ButtonsDemo onToast={toast.success} confirm={confirm} />}
        {tab === 'forms' && <FormsDemo onSaved={() => toast.success('Saved.')} />}
        {tab === 'data' && <DataDemo />}
        {tab === 'feedback' && <FeedbackDemo />}
        {tab === 'intelform' && <IntelFormDemo onToast={toast.success} />}
        {tab === 'icons' && <IconsDemo />}
      </Tabs>
    </div>
  );
}

function ButtonsDemo({onToast, confirm}: {onToast: (message: string) => void; confirm: ReturnType<typeof useConfirm>}) {
  const [pending, setPending] = useState(false);
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="kit-section">
      <Card title="Button" description="One primary per view. Pending while it runs; never pressed twice.">
        <div className="kit-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="danger">Delete</Button>
          <Button icon="plus">With icon</Button>
          <Button variant="secondary" iconEnd="chevron-down">
            Options
          </Button>
          <Button disabled>Disabled</Button>
          <Button
            pending={pending}
            pendingLabel="Saving…"
            onClick={() => {
              setPending(true);
              window.setTimeout(() => setPending(false), 1500);
            }}>
            Click: pending
          </Button>
        </div>
        <div className="kit-row">
          <Button size="sm">Small</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button size="lg">Large</Button>
          <IconButton icon="pencil" label="Edit" />
          <IconButton icon="trash" label="Delete" variant="secondary" />
          <Menu
            label="More actions"
            items={[
              {label: 'Edit', icon: 'pencil', onSelect: () => onToast('Edit picked.')},
              {label: 'Duplicate', icon: 'copy', onSelect: () => onToast('Duplicate picked.')},
              'separator',
              {label: 'Delete', icon: 'trash', danger: true, onSelect: () => onToast('Delete picked.')},
            ]}
          />
        </div>
      </Card>
      <Card title="Dialogs, drawers, confirm, toast" description="Native <dialog>: focus trapped, Esc closes, focus returns.">
        <div className="kit-row">
          <Button variant="secondary" onClick={() => setModal(true)}>
            Open a modal
          </Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            Open a drawer
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void confirm({
                title: 'Delete this item?',
                body: 'It is removed for everyone. This cannot be undone.',
                confirmLabel: 'Delete item',
                pendingLabel: 'Deleting…',
                action: () => new Promise(resolve => window.setTimeout(resolve, 1000)),
              }).then(ok => ok && onToast('Item deleted.'))
            }>
            Confirm a delete
          </Button>
          <Button variant="secondary" onClick={() => onToast('Changes saved.')}>
            Show a toast
          </Button>
        </div>
      </Card>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Invite a teammate"
        description="They get an email with a link to join."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModal(false)}>Send invite</Button>
          </>
        }>
        <Field id="kit-invite" label="Email address">
          <input id="kit-invite" type="email" placeholder="name@example.com" />
        </Field>
      </Modal>
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Edit customer"
        description="A drawer holds a longer form or a record's details."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawer(false)}>
              Cancel
            </Button>
            <Button onClick={() => setDrawer(false)}>Save changes</Button>
          </>
        }>
        <DefinitionList
          items={[
            {label: 'Name', value: 'Maya Patel'},
            {label: 'Email', value: 'maya@example.com'},
            {label: 'Plan', value: <Badge tone="brand">Pro</Badge>},
            {label: 'Status', value: <StatusBadge tone="success">Active</StatusBadge>},
          ]}
        />
      </Drawer>
    </div>
  );
}

function FormsDemo({onSaved}: {onSaved: () => void}) {
  const form = useForm(
    {name: '', email: '', size: 'small', notes: ''},
    {name: [rules.required('Enter a name.'), rules.maxLength(80)], email: [rules.required('Enter an email.'), rules.email()]}
  );
  const [plan, setPlan] = useState<'starter' | 'pro'>('starter');
  const [agree, setAgree] = useState(true);
  const [weekly, setWeekly] = useState(false);
  return (
    <form className="kit-section" noValidate onSubmit={form.submit(() => onSaved())}>
      <Card
        title="Fields"
        description="A visible label, the error under the field in words, shown on blur or submit."
        footer={
          <>
            <Button variant="secondary" onClick={() => form.reset()}>
              Reset
            </Button>
            <Button type="submit">Save</Button>
          </>
        }>
        <div className="form-grid">
          <Field id="f-name" label="Name" error={form.error('name')}>
            <input {...form.field('name')} autoComplete="name" />
          </Field>
          <Field id="f-email" label="Email" hint="We never share it." error={form.error('email')}>
            <input {...form.field('email')} type="email" autoComplete="email" />
          </Field>
          <Field id="f-size" label="Team size (a long list: Select)">
            <Select
              {...form.field('size')}
              options={[
                {value: 'small', label: '1–10 people'},
                {value: 'medium', label: '11–50 people'},
                {value: 'large', label: '51–200 people'},
                {value: 'xl', label: 'More than 200'},
              ]}
            />
          </Field>
          <div className="full">
            <Field id="f-notes" label="Notes" optional>
              <textarea {...form.field('notes')} rows={3} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Choices" description="Five or fewer options: RadioCards. On / off that applies at once: Switch.">
        <div className="form-stack">
          <RadioCards
            legend="Plan"
            name="kit-plan"
            value={plan}
            onChange={setPlan}
            options={[
              {value: 'starter', title: 'Starter', description: 'For one person getting going.'},
              {value: 'pro', title: 'Pro', description: 'For a team, with roles and reports.'},
            ]}
          />
          <Checkbox label="Send me product news" description="About once a month." checked={agree} onChange={setAgree} />
          <Switch label="Weekly summary" description="An email every Monday with last week's numbers." checked={weekly} onChange={setWeekly} />
          <div className="kit-row">
            <SearchInput label="Search customers" placeholder="Search by name" />
            <SegmentedControl
              label="Period"
              value="month"
              onChange={() => undefined}
              options={[
                {value: 'week', label: 'Week'},
                {value: 'month', label: 'Month'},
                {value: 'year', label: 'Year'},
              ]}
            />
          </div>
        </div>
      </Card>
      <Card title="Settings rows">
        <SettingRow title="Public profile" description="Shown to everyone who visits your page.">
          <Switch label="Show my profile" checked onChange={() => undefined} />
        </SettingRow>
        <SettingRow title="Display name" description="How your name appears to others.">
          <Field id="kit-display" label="Display name">
            <input id="kit-display" defaultValue="Maya" />
          </Field>
        </SettingRow>
      </Card>
    </form>
  );
}

function DataDemo() {
  const columns: Column<Sample>[] = [
    {key: 'name', header: 'Customer', cell: row => <Person name={row.name} detail={row.email} />},
    {key: 'plan', header: 'Plan', cell: row => <Badge tone={row.plan === 'Pro' ? 'brand' : 'neutral'}>{row.plan}</Badge>, width: 'shrink'},
    {key: 'status', header: 'Status', cell: row => <StatusBadge tone={STATUS_TONES[row.status]}>{row.status}</StatusBadge>, width: 'shrink'},
    {
      key: 'actions',
      header: 'Actions',
      actions: true,
      cell: row => <Menu label={`Actions for ${row.name}`} items={[{label: 'Open', icon: 'external', onSelect: () => undefined}]} />,
    },
  ];
  return (
    <div className="kit-section">
      <div className="stat-grid">
        <Stat label="Revenue" icon="trending-up" value="$12,480" trend={{label: '+8%', direction: 'up'}} hint="vs last month">
          <Sparkline values={[4, 6, 5, 8, 7, 9, 12]} label="Revenue rose over the last 7 weeks" />
        </Stat>
        <Stat label="Customers" icon="users" value="25+" hint="First page" />
        <Stat label="Refunds" icon="refresh" value="3" trend={{label: '+1', direction: 'up', good: false}} hint="this week" />
        <Stat label="Loading" icon="clock" value={null} />
      </div>
      <Card title="DataTable" description="Loading, empty and error built in; rows become cards on a phone." flush>
        <DataTable caption="Customers" columns={columns} rows={SAMPLE} rowKey={row => row.id} busyKey={2} />
      </Card>
      <div className="grid-2">
        <Card title="BarChart">
          <BarChart
            label="Sign-ups per day"
            data={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({label, value: [3, 5, 4, 8, 6, 2, 4][i]!}))}
          />
        </Card>
        <Card title="ProgressBar, DefinitionList">
          <div className="form-stack">
            <ProgressBar value={62} label="Storage used" />
            <DefinitionList
              items={[
                {label: 'Storage', value: '6.2 GB of 10 GB'},
                {label: 'Renews', value: '1 December'},
              ]}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function FeedbackDemo() {
  return (
    <div className="kit-section">
      <Notice tone="info" title="Info">
        A fact worth knowing.
      </Notice>
      <Notice tone="success" title="Done">
        Your changes are live.
      </Notice>
      <Notice tone="warning" title="Needs attention" action={<Button size="sm" variant="secondary">Fix it</Button>}>
        Your card expires this month.
      </Notice>
      <Notice tone="danger" title="That did not work">
        The server could not be reached. Try again.
      </Notice>
      <div className="grid-2">
        <Card title="Empty state">
          <EmptyState icon="inbox" title="No orders yet" action={<Button icon="plus">Add an order</Button>}>
            Orders show here as customers place them.
          </EmptyState>
        </Card>
        <Card title="Loading">
          <LoadingBlock rows={3} />
        </Card>
      </div>
      <Card title="Badges">
        <div className="kit-row">
          <Badge>Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="success" icon="check">
            Success
          </Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
          <StatusBadge tone="success">Active</StatusBadge>
          <StatusBadge tone="warning">Pending</StatusBadge>
          <StatusBadge tone="danger">Suspended</StatusBadge>
          <StatusBadge tone="neutral">Closed</StatusBadge>
        </div>
      </Card>
    </div>
  );
}

function IconsDemo() {
  const swatches = ['accent', 'accent-soft', 'surface', 'card', 'ink', 'muted', 'line', 'success', 'warning', 'danger', 'info'];
  return (
    <div className="kit-section">
      <Card title="Colour tokens" description="Defined once in src/styles/global.css, light and dark. Change --accent to rebrand.">
        <div className="kit-swatches">
          {swatches.map(name => (
            <div key={name} className="kit-swatch">
              <span className={`swatch-${name}`} />
              <span>--{name}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Icons" description={`<Icon name="…" />, ${ICON_NAMES.length} of them. Add more from lucide.dev in ui/icon.tsx.`}>
        <div className="kit-icons">
          {ICON_NAMES.map(name => (
            <div key={name} className="kit-icon">
              <Icon name={name} size={20} />
              {name}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const COUNTRIES = ['Bangladesh', 'Canada', 'Denmark', 'France', 'Germany', 'India', 'Japan', 'Kenya', 'Mexico', 'Norway', 'Spain', 'United Kingdom', 'United States'].map(name => ({
  value: name.toLowerCase().replaceAll(' ', '-'),
  label: name,
}));

/** The pieces added for IntelForm: pickers, toggles, scales, popovers, the calendar, KPI cards. */
function IntelFormDemo({onToast}: {onToast: (message: string) => void}) {
  const [layout, setLayout] = useState<'classic' | 'paged' | 'one'>('classic');
  const [marks, setMarks] = useState<('bold' | 'italic' | 'underline')[]>(['bold']);
  const [align, setAlign] = useState<'left' | 'center'>('left');
  const [radius, setRadius] = useState(12);
  const [nps, setNps] = useState<number | null>(8);
  const [stars, setStars] = useState<number | null>(4);
  const [faces, setFaces] = useState<number | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  return (
    <div className="kit-section">
      <Card title="StatCard" description="A KPI with a delta (colour + arrow + word); tone chamber for the one hero number.">
        <div className="grid-3">
          <StatCard label="Responses" icon="inbox" value="1,284" delta={{value: '12%', trend: 'up', period: 'vs last 7 days'}} tone="chamber" />
          <StatCard label="Completion rate" icon="check-circle" value="68%" delta={{value: '3%', trend: 'down', period: 'vs last 7 days'}} />
          <StatCard label="Drop-off" icon="trending-down" value={null} />
        </div>
      </Card>
      <Card title="Choices" description="RadioGroup, ToggleGroup (single and multiple), Slider.">
        <div className="form-stack">
          <RadioGroup
            legend="Layout"
            value={layout}
            onChange={setLayout}
            inline
            options={[
              {value: 'classic', label: 'Classic'},
              {value: 'paged', label: 'Paged'},
              {value: 'one', label: 'One at a time'},
            ]}
          />
          <div className="kit-row">
            <ToggleGroup
              label="Text style"
              multiple
              iconOnly
              value={marks}
              onChange={setMarks}
              options={[
                {value: 'bold', label: 'Bold', icon: 'bold'},
                {value: 'italic', label: 'Italic', icon: 'italic'},
                {value: 'underline', label: 'Underline', icon: 'underline'},
              ]}
            />
            <ToggleGroup
              label="Alignment"
              value={align}
              onChange={setAlign}
              options={[
                {value: 'left', label: 'Left', icon: 'align-left'},
                {value: 'center', label: 'Centre', icon: 'columns'},
              ]}
            />
          </div>
          <Slider label="Corner radius" value={radius} onChange={setRadius} min={0} max={32} format={value => `${value} px`} />
        </div>
      </Card>
      <Card title="Answer scales" description="With onChange they are inputs; without, a read-only answer.">
        <div className="form-stack">
          <NpsScale legend="How likely are you to recommend us to a friend?" value={nps} onChange={setNps} />
          <RatingScale legend="How was your visit?" value={stars} onChange={setStars} />
          <RatingScale legend="How do you feel?" variant="emoji" value={faces} onChange={setFaces} />
          <div className="kit-row">
            <NpsScale legend="Read-only NPS answer" value={9} />
            <RatingScale legend="Read-only rating" value={3} />
          </div>
          <NpsSummaryBar detractors={12} passives={20} promoters={41} />
        </div>
      </Card>
      <Card title="Pickers" description="Combobox (type to filter), DatePicker, Calendar.">
        <div className="form-stack">
          <Field label="Country" id="kit-country">
            <Combobox id="kit-country" value={country} onChange={setCountry} options={COUNTRIES} placeholder="Choose a country" searchLabel="Search countries" />
          </Field>
          <Field label="Closes on" id="kit-date" hint="The form stops taking answers that day.">
            <DatePicker id="kit-date" value={date} onChange={setDate} clearable />
          </Field>
          <Calendar value={day} onChange={setDay} label="Pick a day" />
        </div>
      </Card>
      <Card title="Popover, Tooltip, CommandPalette, Collapsible, ScrollArea, Spinner, CopyField">
        <div className="form-stack">
          <div className="kit-row">
            <Popover label="Quick filter" trigger={<><Icon name="filter" size={16} /> Filter</>} triggerClassName="button button-secondary">
              <Checkbox label="Only completed" checked onChange={() => onToast('Changed.')} />
              <Button size="sm" onClick={() => onToast('Applied.')}>Apply</Button>
            </Popover>
            <Tooltip content="Copies the form's link">
              <IconButton icon="link" label="Copy link" variant="secondary" />
            </Tooltip>
            <Button variant="secondary" icon="search" onClick={() => setPalette(true)}>
              Add a field…
            </Button>
            <Spinner label="Loading the preview…" showLabel />
          </div>
          <CommandPalette
            open={palette}
            onClose={() => setPalette(false)}
            label="Add a field"
            commands={[
              {id: 'short', label: 'Short text', group: 'Text', icon: 'text-cursor-input', onSelect: () => onToast('Short text added.')},
              {id: 'long', label: 'Long text', group: 'Text', icon: 'align-left', onSelect: () => onToast('Long text added.')},
              {id: 'nps', label: 'Net Promoter Score', group: 'Rating', icon: 'gauge', onSelect: () => onToast('NPS added.')},
              {id: 'rating', label: 'Rating', group: 'Rating', icon: 'star', onSelect: () => onToast('Rating added.')},
            ]}
          />
          <Collapsible title="Advanced" description="Hidden fields and redirects.">
            <p className="muted">Anything that most forms never need.</p>
          </Collapsible>
          <ScrollArea label="Long list" size="sm">
            <ul className="list">
              {COUNTRIES.map(c => (
                <li key={c.value} className="list-row">
                  {c.label}
                </li>
              ))}
            </ul>
          </ScrollArea>
          <CopyField label="Form link" value="https://example.com/f/customer-survey/" hint="Anyone with the link can answer." />
        </div>
      </Card>
    </div>
  );
}

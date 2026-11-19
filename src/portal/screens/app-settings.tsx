import {useQuery} from '@tanstack/react-query';
import {useNavigate, useSearch} from '@tanstack/react-router';

import {useCan} from '../intelform/lib/can';
import {appSettingsQuery} from '../intelform/queries/app-settings';
import {DataGroup} from '../intelform/settings/data';
import {NotificationsGroup} from '../intelform/settings/delivery';
import {BrandingGroup, GeneralGroup} from '../intelform/settings/general';
import {SiteGroup} from '../intelform/settings/site';
import type {AppSettingsResponse} from '../../server/intelform/settings/view';
import {EmptyState, ErrorNote, LoadingBlock, PageHeader, Tabs} from '../ui';

type TabKey = 'general' | 'branding' | 'site' | 'notifications' | 'data';

const TABS: {value: TabKey; label: string; Group: (props: {view: AppSettingsResponse}) => React.JSX.Element}[] = [
  {value: 'general', label: 'General', Group: GeneralGroup},
  {value: 'branding', label: 'Branding', Group: BrandingGroup},
  {value: 'site', label: 'Public site', Group: SiteGroup},
  {value: 'notifications', label: 'Notifications', Group: NotificationsGroup},
  {value: 'data', label: 'Data', Group: DataGroup},
];

/**
 * `/app-settings`: IntelForm's app-wide settings, for whoever holds `site:intelform:settings`
 * (admins). Accounts, the team, roles and sign-in are the template's own screens (Users, Roles,
 * Your account); emails and file storage are the platform's, so there is nothing to set up here
 * for them. The open tab is the `?tab=` search param, so a link can open one group directly.
 */
export function AppSettings() {
  const allowed = useCan('manageAppSettings');
  return (
    <div className="app-page screen-app-settings">
      <PageHeader
        title="Settings"
        description="App name and branding, the public site, notification defaults and data retention."
      />
      {allowed ? (
        <SettingsTabs />
      ) : (
        <EmptyState icon="lock" title="Only admins can change these settings">
          Ask an admin if something here needs changing.
        </EmptyState>
      )}
    </div>
  );
}

function SettingsTabs() {
  const settings = useQuery(appSettingsQuery);
  const search = useSearch({strict: false}) as {tab?: unknown};
  const navigate = useNavigate();
  const tab = TABS.find(t => t.value === search.tab) ?? TABS[0]!;
  const pick = (next: TabKey) =>
    void navigate({to: '/app-settings', search: (next === 'general' ? {} : {tab: next}) as never, replace: true});

  if (settings.isPending) return <LoadingBlock rows={4} />;
  if (settings.isError) return <ErrorNote error={settings.error} title="Settings didn’t load." />;
  const {Group} = tab;
  return (
    <Tabs label="Settings groups" items={TABS.map(({value, label}) => ({value, label}))} value={tab.value} onChange={pick}>
      {/* Keyed by tab so a group's unsaved edits never leak into another group's form. */}
      <Group key={tab.value} view={settings.data} />
    </Tabs>
  );
}

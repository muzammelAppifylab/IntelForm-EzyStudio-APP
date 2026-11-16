import {AccessSection, AfterSubmitSection, NotificationsSection, SoundsSection, SpamSection} from '../../intelform/builder/settings/sections';
import {WebhookSection} from '../../intelform/builder/settings/WebhookSection';
import {useBuilder} from '../../intelform/builder/store';
import {Notice, PageHeader} from '../../ui';

const NAV = [
  {id: 'access', label: 'Access and limits'},
  {id: 'after-submit', label: 'After submit'},
  {id: 'sounds', label: 'Sounds'},
  {id: 'notifications', label: 'Notifications'},
  {id: 'webhook', label: 'Webhook'},
  {id: 'spam', label: 'Spam protection'},
];

/**
 * `/forms/$formId/settings`: every group of a form's settings. Safe defaults; each change saves
 * on its own through the builder's autosave queue (PATCH /site-api/forms/:id {settings}).
 * Rendered inside BuilderLayout, which provides the builder store.
 */
export function SettingsTab() {
  const readOnly = useBuilder(s => s.readOnly);
  return (
    <div className="app-page screen-form-settings">
      <PageHeader title="Settings" description="Who can answer, when the form closes, notifications and webhooks. Changes save on their own." />
      {readOnly && <Notice tone="info">You can view these settings. Changing them needs permission to edit forms.</Notice>}
      <div className="if-settings-layout">
        <nav aria-label="Settings sections" className="if-settings-nav">
          <ul>
            {NAV.map(n => (
              <li key={n.id}>
                <a
                  href={`#${n.id}`}
                  onClick={e => {
                    // Scroll in place: the router owns the URL, and the hash adds nothing to it.
                    const target = document.getElementById(n.id);
                    if (!target) return;
                    e.preventDefault();
                    target.scrollIntoView({behavior: 'smooth', block: 'start'});
                    target.querySelector<HTMLElement>('h3')?.focus({preventScroll: true});
                  }}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="if-settings-stack">
          <AccessSection />
          <AfterSubmitSection />
          <SoundsSection />
          <NotificationsSection />
          <WebhookSection />
          <SpamSection />
        </div>
      </div>
    </div>
  );
}

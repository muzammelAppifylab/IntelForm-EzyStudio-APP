import type {ReactNode} from 'react';

import {Button, Icon, IconButton, type IconName} from '../../ui';
import {useBuilder, useBuilderStore} from './store';

function Banner({tone, icon, children, action}: {tone: 'info' | 'warning' | 'danger'; icon: IconName; children: ReactNode; action?: ReactNode}) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`if-banner if-banner-${tone}`}>
      <Icon name={icon} size={16} />
      <p className="if-banner-text">{children}</p>
      {action}
    </div>
  );
}

/** "Sam and Alex", "You, in another tab, and Sam". Exported for tests. */
export function editorNames(list: {name: string; self: boolean}[]): string {
  const people = list.map(o => (o.self ? 'You, in another tab,' : o.name));
  if (people.length === 1) return people[0]!;
  return `${people.slice(0, -1).join(', ')} and ${people.at(-1)}`;
}

/** Read-only, other editors, overwritten saves, newer versions and save errors. */
export function Banners() {
  const store = useBuilderStore();
  const readOnly = useBuilder(s => s.readOnly);
  const others = useBuilder(s => s.others);
  const banner = useBuilder(s => s.banner);
  const save = useBuilder(s => s.save);
  const dismiss = <IconButton icon="x" size="sm" label="Dismiss" onClick={() => store.getState().setBanner(null)} />;

  return (
    <div className="if-banners">
      {readOnly && (
        <Banner tone="info" icon="eye">
          You can look at this form but not change it. Ask an admin for the Editor role to make changes.
        </Banner>
      )}
      {!readOnly && others.length > 0 && (
        <Banner tone="warning" icon="users">
          {editorNames(others)} {others.length === 1 && !others[0]!.self ? 'is' : 'are'} also editing this form. The last save wins, so agree
          who edits what.
        </Banner>
      )}
      {banner?.kind === 'overwrote' && (
        <Banner tone="warning" icon="warning" action={dismiss}>
          {banner.name} also edited this form. Your version replaced theirs.
        </Banner>
      )}
      {banner?.kind === 'newer' && (
        <Banner
          tone="info"
          icon="refresh"
          action={
            <span className="if-row">
              <Button size="sm" variant="secondary" onClick={() => location.reload()}>
                Reload
              </Button>
              {dismiss}
            </span>
          }>
          {banner.name} saved a newer version. Reload to see it; if you keep editing, your next save replaces theirs.
        </Banner>
      )}
      {save.status === 'error' && save.error && (
        <Banner tone="danger" icon="alert">
          Your latest changes aren’t saved: {save.error.message}
          {save.error.status === 422 ? ' Undo the last change or fix it to save again.' : ''}
        </Banner>
      )}
    </div>
  );
}

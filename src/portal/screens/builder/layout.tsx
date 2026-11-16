import {useEffect, useState, useSyncExternalStore} from 'react';
import {queryOptions, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, Outlet, useParams, useRouterState} from '@tanstack/react-router';

import type {FormDetail} from '../../../lib/intelform/api-forms';
import {patchForm} from '../../intelform/builder/api';
import {Banners} from '../../intelform/builder/Banners';
import {BuilderHeader} from '../../intelform/builder/BuilderHeader';
import {usePresence, useSaveOnLeave} from '../../intelform/builder/lifecycle';
import {BuilderContext, type BuilderStore, createBuilderStore, useBuilder} from '../../intelform/builder/store';
import {TABS, tabFromPath, type TabId} from '../../intelform/builder/tabs';
import {api, ApiRequestError, errorMessage} from '../../intelform/lib/api';
import {appInfoQuery} from '../../intelform/lib/branding';
import {useCan} from '../../intelform/lib/can';
import {useMe} from '../../shared';
import {buttonClass, EmptyState, Spinner} from '../../ui';
import '../../intelform/builder/build/controls.css';
import '../../intelform/builder/build/build.css';

/**
 * The form the builder edits. The store copies the draft once at mount and autosave never
 * writes back into this cache, so a cached copy would reopen an old draft and revision and
 * overwrite newer saves: it is fetched on every mount (`gcTime: 0`) and never refetched in the
 * background.
 */
export const formDetailQuery = (formId: string) =>
  queryOptions({
    queryKey: ['intelform', 'forms', 'detail', formId],
    queryFn: () => api<FormDetail>(`/site-api/forms/${encodeURIComponent(formId)}`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: (n, err) => !(err instanceof ApiRequestError && err.status < 500) && n < 2,
  });

function useMinWidth(px: number): boolean {
  return useSyncExternalStore(
    cb => {
      const mq = matchMedia(`(min-width: ${px}px)`);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchMedia(`(min-width: ${px}px)`).matches,
    () => true
  );
}

/**
 * `/forms/$formId/*`: one form's builder (PRD "Form builder"). The header (the way back, the
 * form's title, its five tabs, the save state, Preview and Publish) and the banners stay put
 * while the tab below changes (child routes in src/portal/routes.tsx). The builder store lives
 * here, so every tab edits the same draft and autosave keeps running between tabs.
 */
export function BuilderLayout() {
  const {formId} = useParams({from: '/forms/$formId'});
  const query = useQuery(formDetailQuery(formId));
  const me = useMe();

  if (query.isPending || me.isPending) {
    return (
      <div className="screen-builder if-builder is-state">
        <Spinner label="Opening the form…" size="lg" />
      </div>
    );
  }
  // A failed background refetch keeps the data: only a failed first load replaces the builder.
  if (query.isError && !query.data) {
    const gone = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <div className="screen-builder if-builder is-state">
        <EmptyState
          icon={gone ? 'search-x' : 'alert'}
          title={gone ? 'This form no longer exists' : 'The form couldn’t be loaded'}
          action={
            <Link className={buttonClass({variant: 'secondary'})} to="/forms">
              Back to forms
            </Link>
          }>
          {gone ? 'It may have been deleted by someone on your team.' : errorMessage(query.error)}
        </EmptyState>
      </div>
    );
  }
  return <Builder key={formId} detail={query.data!} meId={me.data?.viewer.id ?? 0} />;
}

function Builder({detail, meId}: {detail: FormDetail; meId: number}) {
  const canEdit = useCan('editForms');
  const queryClient = useQueryClient();
  useQuery(appInfoQuery);
  const [store] = useState<BuilderStore>(() =>
    createBuilderStore(detail, {
      send: (body, revision, opts) => patchForm(detail.id, body, revision, opts),
      me: {id: meId},
      readOnly: !canEdit,
      fieldDefaults: () => ({dateFormat: queryClient.getQueryData(appInfoQuery.queryKey)?.dateFormat}),
    })
  );
  useSaveOnLeave(store, detail.id);
  usePresence(store, detail.id, meId);
  const wide = useMinWidth(1024);
  const tab = useRouterState({select: s => tabFromPath(s.location.pathname)});

  return (
    <BuilderContext.Provider value={store}>
      <div className="screen-builder if-builder">
        <DocTitle tab={tab} />
        <BuilderHeader tab={tab} />
        <Banners />
        <div className="if-builder-main" key={tab ?? ''}>
          {!wide && tab !== 'responses' ? <SmallScreen formId={detail.id} /> : <Outlet />}
        </div>
      </div>
    </BuilderContext.Provider>
  );
}

function SmallScreen({formId}: {formId: string}) {
  return (
    <div className="if-small-screen">
      <EmptyState
        icon="monitor"
        title="Use a larger screen to edit"
        action={
          <Link className={buttonClass()} to="/forms/$formId/responses" params={{formId}}>
            View responses
          </Link>
        }>
        The builder needs a window at least 1024 pixels wide. You can still read responses here.
      </EmptyState>
    </div>
  );
}

/**
 * Browser tab title: "<Tab> · <form title> · Form builder", following renames. Set a frame after
 * the shell's own title effect (which runs after ours on the same commit).
 */
function DocTitle({tab}: {tab: TabId | null}) {
  const title = useBuilder(s => s.doc.title);
  const label = TABS.find(t => t.id === tab)?.label ?? 'Build';
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      document.title = `${label} · ${title || 'Untitled form'} · Form builder`;
    });
    return () => cancelAnimationFrame(id);
  }, [label, title]);
  return null;
}

import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useParams } from 'react-router'
import { Monitor } from 'lucide-react'
import type { FormDetail } from '@shared/api-forms'
import { EmptyState } from '@/components/ds'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { Button } from '@/components/ui/button'
import { api, ApiRequestError, errorMessage } from '@/lib/api'
import { appInfoQuery, useCan, useMe } from '@/lib/auth'
import { patchForm } from '@/builder/api'
import { useSaveOnLeave, usePresence } from '@/builder/lifecycle'
import { BuilderContext, createBuilderStore, useBuilder, type BuilderStore } from '@/builder/store'
import { Banners } from './Banners'
import { BuilderHeader } from './BuilderHeader'
import { TABS, type TabId } from './tabs'
import { BuildTab } from './build/BuildTab'
import { DesignTab } from './design/DesignTab'
import { SettingsTab } from './settings/SettingsTab'
import { ShareTab } from './share/ShareTab'

const ResponsesTab = lazy(() => import('./responses/ResponsesTab'))

const formQueryKey = (id: string) => ['forms', 'detail', id] as const

function useMinWidth(px: number): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(`(min-width: ${px}px)`)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(`(min-width: ${px}px)`).matches,
    () => true,
  )
}

/** One route, five tabs (PRD "Form builder"). The tab lives in the URL so it can be linked. */
export default function BuilderPage() {
  const { formId = '', tab } = useParams()
  const active = TABS.find((t) => t.id === tab)
  const query = useQuery({
    queryKey: formQueryKey(formId),
    queryFn: () => api<FormDetail>(`/api/forms/${formId}`),
    staleTime: Infinity,
    // The store copies the draft once at mount and autosave never writes back here, so a cached
    // copy would reopen an old draft and revision and overwrite newer saves: fetch on every mount.
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: (n, err) => !(err instanceof ApiRequestError && err.status < 500) && n < 2,
  })

  if (!active) return <Navigate to={`/dashboard/forms/${formId}/build`} replace />
  if (query.isPending) return <FullPageSpinner />
  // A failed background refetch keeps the data: only a failed first load replaces the builder.
  if (query.isError && !query.data) {
    const gone = query.error instanceof ApiRequestError && query.error.status === 404
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <title>Form builder</title>
        <EmptyState
          title={gone ? 'This form no longer exists' : 'The form couldn’t be loaded'}
          actions={
            <Button asChild>
              <Link to="/dashboard">Back to forms</Link>
            </Button>
          }
        >
          {gone ? 'It may have been deleted by someone on your team.' : errorMessage(query.error)}
        </EmptyState>
      </main>
    )
  }
  return <Builder key={formId} detail={query.data!} tab={active.id} />
}

function Builder({ detail, tab }: { detail: FormDetail; tab: TabId }) {
  const me = useMe()
  const canEdit = useCan('forms.edit')
  const queryClient = useQueryClient()
  useQuery(appInfoQuery)
  const [store] = useState<BuilderStore>(() =>
    createBuilderStore(detail, {
      send: (body, revision, opts) => patchForm(detail.id, body, revision, opts),
      me: { id: me.id },
      readOnly: !canEdit,
      fieldDefaults: () => ({ dateFormat: queryClient.getQueryData(appInfoQuery.queryKey)?.dateFormat }),
    }),
  )
  useSaveOnLeave(store, detail.id)
  usePresence(store, detail.id, me.id)
  const wide = useMinWidth(1024)
  const label = TABS.find((t) => t.id === tab)!.label

  useEffect(() => {
    // Leave the app's own scroll alone: the builder panes scroll themselves.
    document.documentElement.classList.add('overflow-hidden')
    return () => document.documentElement.classList.remove('overflow-hidden')
  }, [])

  return (
    <BuilderContext.Provider value={store}>
      <div data-shell="builder" className="grid h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr] bg-background text-foreground">
        <meta name="robots" content="noindex" />
        <DocTitle label={label} />
        <BuilderHeader tab={tab} />
        <Banners />
        <main key={tab} className="min-h-0 animate-fade-in">
          {!wide && tab !== 'responses' ? (
            <SmallScreen formId={detail.id} />
          ) : tab === 'build' ? (
            <BuildTab />
          ) : tab === 'design' ? (
            <DesignTab />
          ) : tab === 'settings' ? (
            <SettingsTab />
          ) : tab === 'share' ? (
            <ShareTab />
          ) : (
            <div className="h-full overflow-y-auto p-6">
              <Suspense fallback={<FullPageSpinner />}>
                <ResponsesTab formId={detail.id} />
              </Suspense>
            </div>
          )}
        </main>
      </div>
    </BuilderContext.Provider>
  )
}

function SmallScreen({ formId }: { formId: string }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <EmptyState
        icon={Monitor}
        title="Use a larger screen to edit"
        actions={
          <Button asChild>
            <Link to={`/dashboard/forms/${formId}/responses`}>View responses</Link>
          </Button>
        }
      >
        The builder needs a window at least 1024 pixels wide. You can still read responses here.
      </EmptyState>
    </div>
  )
}

/** Browser tab title; follows the form's title as it is renamed. */
function DocTitle({ label }: { label: string }) {
  const title = useBuilder((s) => s.doc.title)
  return <title>{`${label} · ${title} · Form builder`}</title>
}

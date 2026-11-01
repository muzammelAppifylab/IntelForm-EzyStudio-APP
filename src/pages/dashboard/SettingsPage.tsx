import { useQuery } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router'
import { FormError } from '@/components/common/Field'
import { PageHeader } from '@/components/common/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { DataGroup, StorageGroup } from '@/pages/dashboard/settings/DataGroups'
import { EmailGroup, SpamGroup } from '@/pages/dashboard/settings/DeliveryGroups'
import { BrandingGroup, GeneralGroup } from '@/pages/dashboard/settings/GeneralGroups'
import { SiteGroup } from '@/pages/dashboard/settings/SiteGroups'
import { settingsQuery } from '@/pages/dashboard/settings/queries'

const TABS = [
  { id: 'general', label: 'General', Group: GeneralGroup },
  { id: 'branding', label: 'Branding', Group: BrandingGroup },
  { id: 'site', label: 'Public site', Group: SiteGroup },
  { id: 'spam', label: 'Spam protection', Group: SpamGroup },
  { id: 'email', label: 'Email', Group: EmailGroup },
  { id: 'storage', label: 'Storage', Group: StorageGroup },
  { id: 'data', label: 'Data', Group: DataGroup },
] as const

/** Owner only: Editors and Viewers never see the link, and the API answers 403. */
export default function SettingsPage() {
  if (!useCan('settings.manage')) return <Navigate to="/dashboard" replace />
  return <OwnerSettings />
}

function OwnerSettings() {
  const settings = useQuery(settingsQuery)
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'general'

  return (
    <div className="grid gap-8">
      <PageHeader title="Settings" description="App name and branding, the public site, spam protection, email, storage and data retention." />
      {settings.isPending ? (
        <div className="grid max-w-3xl gap-4" aria-busy>
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : settings.isError ? (
        <div className="max-w-3xl">
          <FormError message={`Settings didn’t load. ${errorMessage(settings.error)}`} />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(t) => setParams(t === 'general' ? {} : { tab: t }, { replace: true })} className="grid w-full max-w-3xl gap-6">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList aria-label="Settings groups">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {TABS.map(({ id, Group }) => (
            <TabsContent key={id} value={id}>
              <Group view={settings.data} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

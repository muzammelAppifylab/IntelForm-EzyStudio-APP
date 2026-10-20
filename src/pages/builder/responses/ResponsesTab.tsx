import { useCallback } from 'react'
import { Inbox } from 'lucide-react'
import { Link } from 'react-router'
import type { SummaryResponse } from '@shared/api-responses'
import { EmptyState } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResponseDrawer } from './ResponseDrawer'
import { SummaryView } from './SummaryView'
import { TableView } from './TableView'
import { useResponsesUrl } from './queries'

/**
 * Builder → Responses tab: Summary (default) and Table views, plus the response drawer.
 * All view state is in the URL (?view=table&q=&filter=…&response=<id>), so every view can be
 * linked, and charts can open the table filtered to what was clicked. Owned by: Agent G.
 */
export default function ResponsesTab({ formId }: { formId: string }) {
  const { view, table, summary, responseId, update } = useResponsesUrl()

  const openResponse = useCallback((id: string) => update({ response: id }), [update])
  const navigate = useCallback((id: string) => update({ response: id }, { replace: true }), [update])
  const closeResponse = useCallback(() => update({ response: null }), [update])

  /** Summary → table, keeping the summary's date range so counts match. */
  const toTable = (patch: Record<string, string | string[] | null>, range: SummaryResponse['range']) =>
    update({
      view: 'table',
      q: null,
      page: null,
      filter: null,
      has: null,
      sort: null,
      dir: null,
      tfrom: range.from,
      tto: range.to,
      ...patch,
    })

  const empty = (
    <EmptyState icon={Inbox} title="No responses yet" actions={
      <Button asChild>
        <Link to={`/dashboard/forms/${formId}/share`}>Share your form</Link>
      </Button>
    }>
      Share your form to start collecting them.
    </EmptyState>
  )

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading text-foreground">Responses</h2>
        <Tabs value={view} onValueChange={(v) => update({ view: v === 'table' ? 'table' : null, page: null })}>
          <TabsList aria-label="Responses view">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === 'summary' ? (
        <SummaryView
          formId={formId}
          state={summary}
          empty={empty}
          onRange={(range, from, to) => update({ range: range === '30d' ? null : range, from: from ?? null, to: to ?? null }, { replace: true })}
          onFilter={(fieldId, value, range) => toTable({ filter: [`${fieldId}:${value}`] }, range)}
          onViewAll={(fieldId, range) => toTable({ has: fieldId }, range)}
          onOpenResponse={openResponse}
        />
      ) : (
        <TableView formId={formId} state={table} update={update} openResponse={openResponse} activeResponseId={responseId} empty={empty} />
      )}

      <ResponseDrawer formId={formId} responseId={responseId} table={table} onNavigate={navigate} onClose={closeResponse} />
    </div>
  )
}

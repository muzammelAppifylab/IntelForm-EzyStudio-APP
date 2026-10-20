import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { frontPagePatch, type FeaturedFormView, type FrontPageContent, type FrontPageView } from '@shared/api-front'
import { FormError } from '@/components/common/Field'
import { PageHeader } from '@/components/common/PageHeader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorMessage } from '@/lib/api'
import { useCan } from '@/lib/auth'
import { FeaturedForms } from '@/pages/dashboard/front-page/FeaturedForms'
import { frontPageQuery, pickableFormsQuery } from '@/pages/dashboard/front-page/queries'
import { Preview } from '@/pages/dashboard/front-page/Preview'
import { AboutSection, ContactSection, HeroSection, LegalSection, LookSection, SeoSection } from '@/pages/dashboard/front-page/Sections'
import { GroupCard, SwitchRow } from '@/pages/dashboard/settings/bits'
import { apiErrors, same, zodErrors, type Errors } from '@/pages/dashboard/settings/form-utils'

/** Front page editor (PRD): Owner and Editors edit with one explicit Save; Viewers see it read-only. */
export default function FrontPageEditorPage() {
  const query = useQuery(frontPageQuery)
  return (
    <div className="grid gap-8">
      {query.isPending ? (
        <>
          <PageHeader title="Front page" description="Your public forms hub: a hero, featured forms, about and contact blocks." />
          <div className="grid gap-4" aria-busy>
            <Skeleton className="h-24 w-full max-w-2xl" />
            <Skeleton className="h-96 w-full max-w-2xl" />
          </div>
        </>
      ) : query.isError ? (
        <>
          <PageHeader title="Front page" />
          <div className="max-w-2xl">
            <FormError message={`The front page didn’t load. ${errorMessage(query.error)}`} />
          </div>
        </>
      ) : (
        <Editor saved={query.data} />
      )}
    </div>
  )
}

function Editor({ saved }: { saved: FrontPageView }) {
  const canEdit = useCan('frontPage.edit')
  const readOnly = !canEdit
  const queryClient = useQueryClient()
  const [content, setContent] = useState<FrontPageContent>(saved.content)
  const [featured, setFeatured] = useState<FeaturedFormView[]>(saved.featured)
  const [errors, setErrors] = useState<Errors>({})

  const featuredInput = (list: FeaturedFormView[]) => list.map((f) => ({ formId: f.formId, description: f.description }))
  const dirty = !same(content, saved.content) || !same(featuredInput(featured), featuredInput(saved.featured))

  // Leaving with unsaved edits asks first (tab close or reload).
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', onBeforeUnload)
    return () => removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const save = useMutation({
    mutationFn: (body: unknown) => api<FrontPageView>('/api/front-page', { method: 'PATCH', body }),
    onSuccess: (view) => {
      queryClient.setQueryData(frontPageQuery.queryKey, view)
      void queryClient.invalidateQueries({ queryKey: pickableFormsQuery.queryKey })
      void queryClient.invalidateQueries({ queryKey: ['public-home'] })
      setContent(view.content)
      setFeatured(view.featured)
      toast.success('Front page saved')
    },
    onError: (err) => {
      setErrors(apiErrors(err))
      toast.error('The front page wasn’t saved. Check the highlighted fields.')
    },
  })

  function submit() {
    const r = zodErrors(frontPagePatch, { ...content, featured: featuredInput(featured) })
    if (r.errors) {
      setErrors(r.errors)
      toast.error('Fix the highlighted fields, then save.')
      return
    }
    setErrors({})
    save.mutate(r.data)
  }

  const update = <K extends keyof FrontPageContent>(key: K, value: FrontPageContent[K]) => setContent((c) => ({ ...c, [key]: value }))
  const section = { content, update, errors, readOnly }

  return (
    <>
      <PageHeader
        title="Front page"
        description="Your public forms hub at the home page: a hero, featured forms, about and contact blocks."
        actions={
          <>
            {saved.content.enabled && (
              <Button asChild variant="outline">
                <a href="/" target="_blank" rel="noopener">
                  <ExternalLink aria-hidden />
                  View page
                </a>
              </Button>
            )}
            {canEdit && (
              <Button type="button" onClick={submit} disabled={!dirty || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
          </>
        }
      />
      {readOnly && (
        <Alert variant="info" className="max-w-2xl">
          <Eye aria-hidden />
          <AlertDescription className="text-info-subtle-foreground">You can view the front page settings. The Owner or an Editor can change them.</AlertDescription>
        </Alert>
      )}
      {canEdit && dirty && (
        <p className="-mt-4 text-caption text-muted-foreground" role="status">
          Unsaved changes. Save to update the public page.
        </p>
      )}

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
        <fieldset disabled={readOnly} className="grid min-w-0 gap-6">
          <legend className="sr-only">Front page settings</legend>
          <FormError message={errors._form ?? null} />
          <GroupCard title="Visibility" readOnly>
            <SwitchRow
              label="Show the front page"
              description="When off, visitors to the home page go to the login screen."
              checked={content.enabled}
              onCheckedChange={(v) => update('enabled', v)}
              disabled={readOnly}
            />
          </GroupCard>
          <HeroSection {...section} />
          <GroupCard title="Featured forms" description="Live forms shown as cards. Closed and unpublished forms drop off the page by themselves." readOnly>
            <FeaturedForms value={featured} onChange={setFeatured} readOnly={readOnly} errors={errors} />
          </GroupCard>
          <AboutSection {...section} />
          <ContactSection {...section} />
          <LookSection {...section} />
          <SeoSection {...section} />
          <LegalSection {...section} />
        </fieldset>

        <aside aria-label="Preview" className="grid gap-3 xl:sticky xl:top-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-label">Preview</h2>
            <span className="text-caption text-muted-foreground">{content.enabled ? 'Updates as you type' : 'The page is off: visitors see the login screen'}</span>
          </div>
          <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-lg">
            <Preview content={content} featured={featured} />
          </div>
        </aside>
      </div>
    </>
  )
}

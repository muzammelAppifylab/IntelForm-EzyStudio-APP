import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type {
  CreatedForm,
  CreateFormInput,
  FormListItem,
  FormsListQuery,
  FormsListResponse,
  FormStatusResponse,
  FormsView,
  FormsViewResponse,
  SaveAsTemplateInput,
  TemplatesResponse,
  TemplateSummary,
} from '@shared/api-forms'
import { api, errorMessage } from '@/lib/api'

export const formsKey = ['forms'] as const

export function formsListQuery(params: FormsListQuery) {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status !== 'all') search.set('status', params.status)
  if (params.sort !== 'updated') search.set('sort', params.sort)
  const qs = search.toString()
  return queryOptions({
    queryKey: [...formsKey, 'list', params],
    queryFn: () => api<FormsListResponse>(`/api/forms${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  })
}

export const templatesQuery = queryOptions({
  queryKey: ['templates'],
  queryFn: () => api<TemplatesResponse>('/api/templates'),
  staleTime: 60_000,
})

export const publicFormUrl = (slug: string) => `${location.origin}/f/${slug}`
export const builderPath = (id: string) => `/dashboard/forms/${id}/build`
export const responsesPath = (id: string) => `/dashboard/forms/${id}/responses`

/** Creates a form (blank or from a template) and opens it in the builder. */
export function useCreateForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (input: CreateFormInput) => api<CreatedForm>('/api/forms', { method: 'POST', body: input }),
    onSuccess: (form) => {
      queryClient.invalidateQueries({ queryKey: formsKey })
      toast.success('Form created')
      navigate(builderPath(form.id))
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

/** Row actions shared by the grid and the list. */
export function useFormActions() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: formsKey })
  const onError = (err: unknown) => toast.error(errorMessage(err))

  const duplicate = useMutation({
    mutationFn: (form: FormListItem) => api<CreatedForm>(`/api/forms/${form.id}/duplicate`, { method: 'POST' }),
    onSuccess: () => (toast.success('Form duplicated'), refresh()),
    onError,
  })
  const close = useMutation({
    mutationFn: (form: FormListItem) => api<FormStatusResponse>(`/api/forms/${form.id}/close`, { method: 'POST' }),
    onSuccess: () => (toast.success('Form closed'), refresh()),
    onError,
  })
  const reopen = useMutation({
    mutationFn: (form: FormListItem) => api<FormStatusResponse>(`/api/forms/${form.id}/reopen`, { method: 'POST' }),
    onSuccess: () => (toast.success('Form reopened'), refresh()),
    onError,
  })

  async function copyLink(form: FormListItem) {
    try {
      await navigator.clipboard.writeText(publicFormUrl(form.slug))
      toast.success(form.status === 'draft' ? 'Link copied. It works once you publish the form.' : 'Link copied')
    } catch {
      toast.error('Couldn’t copy. Select the link in the Share tab instead.')
    }
  }

  return { duplicate, close, reopen, copyLink }
}

export function useRenameForm(onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api(`/api/forms/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: () => {
      toast.success('Form renamed')
      queryClient.invalidateQueries({ queryKey: formsKey })
      onDone()
    },
  })
}

export function useDeleteForm(onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, confirmTitle }: { id: string; confirmTitle: string }) =>
      api(`/api/forms/${id}`, { method: 'DELETE', body: { confirmTitle } }),
    onSuccess: () => {
      toast.success('Form deleted')
      queryClient.invalidateQueries({ queryKey: formsKey })
      onDone()
    },
  })
}

export function useSaveAsTemplate(onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: SaveAsTemplateInput & { id: string }) =>
      api<TemplateSummary>(`/api/forms/${id}/save-as-template`, { method: 'POST', body: input }),
    onSuccess: () => {
      toast.success('Saved as template')
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      onDone()
    },
  })
}

const VIEW_KEY = 'intelform.forms.view'

function readLocalView(): FormsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/**
 * Grid or list, remembered per user on the server. localStorage gives the first paint (and
 * the fallback if the server can't be reached).
 */
export function useFormsView(): [FormsView, (v: FormsView) => void] {
  const queryClient = useQueryClient()
  const [initial] = useState<FormsView>(readLocalView)
  const [chosen, setChosen] = useState<FormsView | null>(null)
  const server = useQuery({
    queryKey: ['prefs', 'forms.view'],
    queryFn: async () => {
      const data = await api<FormsViewResponse>('/api/forms/prefs/view')
      writeLocalView(data.view)
      return data
    },
    staleTime: Infinity,
    retry: false,
  })
  const save = useMutation({
    mutationFn: (v: FormsView) => api<FormsViewResponse>('/api/forms/prefs/view', { method: 'PATCH', body: { view: v } }),
    onSuccess: (data) => queryClient.setQueryData(['prefs', 'forms.view'], data),
  })

  function change(v: FormsView) {
    setChosen(v)
    writeLocalView(v)
    save.mutate(v)
  }
  return [chosen ?? server.data?.view ?? initial, change]
}

function writeLocalView(v: FormsView) {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // Storage blocked: the server copy is enough.
  }
}

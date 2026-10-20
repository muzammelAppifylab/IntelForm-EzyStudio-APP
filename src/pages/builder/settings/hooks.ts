import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BUILDER_API, type BuilderCapabilities } from '@shared/api-builder'
import type { FormDetail } from '@shared/api-forms'
import type { FormSettingsPatch } from '@shared/form/settings'
import { api, errorMessage } from '@/lib/api'
import { useBuilderStore } from '@/builder/store'

export function useCapabilities() {
  return useQuery({
    queryKey: ['builder', 'capabilities'],
    queryFn: () => api<BuilderCapabilities>(`${BUILDER_API}/capabilities`),
    staleTime: 60_000,
  })
}

/**
 * Saves a settings patch through the autosave queue. Validation errors land on the setting
 * that caused them (keys like "redirectUrl"); anything else is a toast.
 */
export function useSettingsSave() {
  const store = useBuilderStore()
  const [errors, setErrors] = useState<Record<string, string>>({})
  async function save(patch: FormSettingsPatch, success?: string): Promise<boolean> {
    const keys = Object.keys(patch)
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k.split('.')[0]))))
    try {
      await store.getState().patchSettings(patch)
      if (success) toast.success(success)
      return true
    } catch (raw) {
      const err = raw as { message?: string; fields?: Record<string, string[] | undefined> }
      const fields = Object.entries(err.fields ?? {})
        .map(([k, v]) => [k.replace(/^settings\./, ''), v?.[0] ?? ''] as const)
        .filter(([k, v]) => v !== '' && k !== 'settings')
      if (fields.length) setErrors((e) => ({ ...e, ...Object.fromEntries(fields) }))
      else toast.error(errorMessage(raw))
      return false
    }
  }
  return { save, errors }
}

/** After close/reopen/publish: pick up the server's revision so autosave isn't seen as a conflict. */
export async function refreshFromServer(store: ReturnType<typeof useBuilderStore>) {
  const detail = await api<FormDetail>(`/api/forms/${store.getState().meta.id}`)
  store.queue.rebase(detail.revision)
  store.setState({ settings: detail.settings })
  store.getState().setMeta({ status: detail.status, hasUnpublished: detail.hasUnpublished, responses: detail.counts.responses })
}

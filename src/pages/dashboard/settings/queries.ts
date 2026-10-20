import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AppSettingsPatch, AppSettingsView, SettingsTestResult } from '@shared/settings-app'
import { api } from '@/lib/api'
import { appInfoQuery } from '@/lib/auth'

export const settingsQuery = { queryKey: ['settings'], queryFn: () => api<AppSettingsView>('/api/settings') }

/** PATCH one group; the response is the whole view, so the cache is replaced. */
export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api<AppSettingsView>('/api/settings', { method: 'PATCH', body: patch }),
    onSuccess: (view) => {
      queryClient.setQueryData(settingsQuery.queryKey, view)
      // App name, logo and branding show in the sidebar and on the login page.
      void queryClient.invalidateQueries({ queryKey: appInfoQuery.queryKey })
    },
  })
}

/** The "Test" buttons: POST /api/settings/{spam,email,storage}/test. */
export function useSettingsTest(group: 'spam' | 'email' | 'storage') {
  return useMutation({
    mutationFn: (body: object = {}) => api<SettingsTestResult>(`/api/settings/${group}/test`, { method: 'POST', body }),
  })
}

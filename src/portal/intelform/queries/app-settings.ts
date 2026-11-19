import {queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {SavedThemesResponse} from '../../../lib/intelform/api-builder';
import type {AppSettingsPatch} from '../../../lib/intelform/settings-app';
import {APP_SETTINGS_API, type AppSettingsResponse} from '../../../server/intelform/settings/view';
import {appInfoQuery} from '../lib/branding';
import {api} from '../lib/api';

/** App settings (admins): GET /site-api/app-settings. The screen reads the database, never a cache. */
export const appSettingsQuery = queryOptions({
  queryKey: ['intelform', 'app-settings'],
  queryFn: () => api<AppSettingsResponse>(APP_SETTINGS_API),
});

/** Saved themes for the "Default theme for new forms" picker (GET /site-api/themes). */
export const settingsThemesQuery = queryOptions({
  queryKey: ['intelform', 'app-settings', 'themes'],
  queryFn: () => api<SavedThemesResponse>('/site-api/themes'),
  retry: false,
});

/** PATCH one group; the answer is the whole view, so the cached view is replaced. */
export function useSaveAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api<AppSettingsResponse>(APP_SETTINGS_API, {method: 'PATCH', body: patch}),
    onSuccess: view => {
      queryClient.setQueryData(appSettingsQuery.queryKey, view);
      // The app name, logo, favicon, accent and mode show in the dashboard shell and public pages.
      void queryClient.invalidateQueries({queryKey: appInfoQuery.queryKey});
    },
  });
}

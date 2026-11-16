import {queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';

import type {TemplatePatchInput, TemplatesResponse} from '../../../lib/intelform/api-forms';
import {api} from '../lib/api';

/**
 * The template gallery (`/site-api/templates`): built-in templates (in code) and the ones the
 * team saved. Mutations invalidate by prefix `['intelform', 'templates']`.
 */

export const templatesKey = ['intelform', 'templates'] as const;
export const TEMPLATES_PATH = '/site-api/templates';

export const templatesQuery = queryOptions({
  queryKey: [...templatesKey, 'list'],
  queryFn: () => api<TemplatesResponse>(TEMPLATES_PATH),
  staleTime: 60_000,
});

/** Rename (and re-describe) a saved template; built-ins answer 403. */
export function useRenameTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({id, ...input}: TemplatePatchInput & {id: string}) =>
      api<{ok: true}>(`${TEMPLATES_PATH}/${id}`, {method: 'PATCH', body: input}),
    onSuccess: () => queryClient.invalidateQueries({queryKey: templatesKey}),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${TEMPLATES_PATH}/${id}`, {method: 'DELETE'}),
    onSuccess: () => queryClient.invalidateQueries({queryKey: templatesKey}),
  });
}

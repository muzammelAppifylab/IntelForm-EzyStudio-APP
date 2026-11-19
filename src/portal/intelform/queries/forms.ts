import {keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';

import type {
  CreatedForm,
  CreateFormInput,
  FormListItem,
  FormSort,
  FormsListResponse,
  FormsStrip,
  FormStatus,
  FormStatusResponse,
  FormsView,
  FormsViewResponse,
  SaveAsTemplateInput,
  TemplateSummary,
} from '../../../lib/intelform/api-forms';
import {FORMS_PAGE_SIZE, FORMS_PAGE_SIZES} from '../../../lib/intelform/api-forms';
import {useToast} from '../../ui';
import {publicFormUrl} from '../forms/format';
import {api, errorMessage} from '../lib/api';
import {FIRST_PAGE, type PageNav} from './responses';
import {templatesKey} from './templates';

/**
 * The forms list, the weekly strip, the overview's recent responses and every list action
 * (`/site-api/forms`). Mutations invalidate by prefix `['intelform', 'forms']`.
 */

export const formsKey = ['intelform', 'forms'] as const;
export const FORMS_PATH = '/site-api/forms';

export interface FormsFilter {
  q: string;
  status: FormStatus | 'all';
  sort: FormSort;
}

export const DEFAULT_FORMS_FILTER: FormsFilter = {q: '', status: 'all', sort: 'updated'};

/** One page as the server sends it: keyset, `nextCursor` null on the last page. */
export type FormsPage = FormsListResponse;

/** `?q=…&status=…&sort=…&cursor=…` (or `before` / `last`), `page`, `size`; defaults left out. */
export function formsListPath(filter: FormsFilter, cursor?: string | null, nav: PageNav = FIRST_PAGE, size: number = FORMS_PAGE_SIZE): string {
  const search = new URLSearchParams();
  const q = filter.q.trim();
  if (q) search.set('q', q);
  if (filter.status !== 'all') search.set('status', filter.status);
  if (filter.sort !== 'updated') search.set('sort', filter.sort);
  const after = cursor ?? nav.cursor;
  if (after) search.set('cursor', after);
  else if (nav.before) search.set('before', nav.before);
  else if (nav.last) search.set('last', String(nav.last));
  if (nav.page > 1) search.set('page', String(nav.page));
  if (size !== FORMS_PAGE_SIZE) search.set('size', String(size));
  const qs = search.toString();
  return `${FORMS_PATH}${qs ? `?${qs}` : ''}`;
}

const SIZE_KEY = 'intelform:forms-page-size';

/** Forms per page this person last picked, in this browser. */
export function rememberedFormsSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return (FORMS_PAGE_SIZES as readonly number[]).includes(n) ? n : FORMS_PAGE_SIZE;
  } catch {
    return FORMS_PAGE_SIZE;
  }
}

export function rememberFormsSize(n: number): void {
  try {
    localStorage.setItem(SIZE_KEY, String(n));
  } catch {
    // Storage blocked: the default size next time.
  }
}

/** One numbered page of the forms list by keyset (the dashboard's pager); filter, size and position in the key. */
export const formsListQuery = (filter: FormsFilter, size: number = FORMS_PAGE_SIZE, nav: PageNav = FIRST_PAGE) =>
  queryOptions({
    queryKey: [...formsKey, 'list', filter, size, nav],
    // The signal cancels a request a newer search has replaced.
    queryFn: ({signal}) => api<FormsPage>(formsListPath(filter, null, nav, size), {signal}),
    placeholderData: keepPreviousData,
    gcTime: 60_000,
  });

/** The first page in the default order: the overview's "Recent forms". */
export const recentFormsQuery = queryOptions({
  queryKey: [...formsKey, 'recent'],
  queryFn: ({signal}) => api<FormsPage>(FORMS_PATH, {signal}),
  staleTime: 30_000,
});

/** Workspace-wide numbers above the list; they don't change with search, filter or page. */
export const formsStripQuery = queryOptions({
  queryKey: [...formsKey, 'strip'],
  queryFn: () => api<FormsStrip>(`${FORMS_PATH}/strip`),
  staleTime: 60_000,
});

/** One of the latest responses, across every form (the overview). */
export interface RecentResponse {
  id: string;
  formId: string;
  formTitle: string;
  submittedAt: string;
  /** Filled from the answers by the database (contact fields), or null. */
  contactName: string | null;
  contactEmail: string | null;
}

export interface RecentResponsesResponse {
  responses: RecentResponse[];
}

/** GET /site-api/forms/recent-responses (RESPONSE_READ): the newest few, newest first. */
export const recentResponsesQuery = queryOptions({
  queryKey: [...formsKey, 'recent-responses'],
  queryFn: () => api<RecentResponsesResponse>(`${FORMS_PATH}/recent-responses`),
  staleTime: 30_000,
  retry: false,
});

export const formsViewQuery = queryOptions({
  queryKey: [...formsKey, 'prefs', 'view'],
  queryFn: () => api<FormsViewResponse>(`${FORMS_PATH}/prefs/view`),
  staleTime: Infinity,
  retry: false,
});

/** Creates a form (blank or from a template) and opens it in the builder. */
export function useCreateForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: CreateFormInput) => api<CreatedForm>(FORMS_PATH, {method: 'POST', body: input}),
    onSuccess: form => {
      // We leave the list right away: refresh it when it's next shown.
      void queryClient.invalidateQueries({queryKey: formsKey, refetchType: 'none'});
      toast.success('Form created.');
      void navigate({to: '/forms/$formId/build', params: {formId: form.id}});
    },
    onError: err => toast.danger(errorMessage(err)),
  });
}

/** Row actions shared by the grid and the list. */
export function useFormActions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => queryClient.invalidateQueries({queryKey: formsKey});
  const onError = (err: unknown) => toast.danger(errorMessage(err));

  const duplicate = useMutation({
    mutationFn: (form: FormListItem) => api<CreatedForm>(`${FORMS_PATH}/${form.id}/duplicate`, {method: 'POST'}),
    onSuccess: () => {
      toast.success('Form duplicated.');
      void refresh();
    },
    onError,
  });
  const close = useMutation({
    mutationFn: (form: FormListItem) => api<FormStatusResponse>(`${FORMS_PATH}/${form.id}/close`, {method: 'POST'}),
    onSuccess: () => {
      toast.success('Form closed.');
      void refresh();
    },
    onError,
  });
  const reopen = useMutation({
    mutationFn: (form: FormListItem) => api<FormStatusResponse>(`${FORMS_PATH}/${form.id}/reopen`, {method: 'POST'}),
    onSuccess: () => {
      toast.success('Form reopened.');
      void refresh();
    },
    onError,
  });

  async function copyLink(form: FormListItem) {
    try {
      await navigator.clipboard.writeText(publicFormUrl(window.location.origin, form.slug));
      toast.success(form.status === 'draft' ? 'Link copied. It works once you publish the form.' : 'Link copied.');
    } catch {
      toast.danger('Couldn’t copy. Select the link in the Share tab instead.');
    }
  }

  /** The row being acted on, so only that one dims. */
  const busyId =
    (duplicate.isPending && duplicate.variables?.id) ||
    (close.isPending && close.variables?.id) ||
    (reopen.isPending && reopen.variables?.id) ||
    undefined;

  return {duplicate, close, reopen, copyLink, busyId};
}

/** Rename = a PATCH of the title only (no If-Match: a rename is never a conflict worth refusing). */
export function useRenameForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({id, title}: {id: string; title: string}) => api(`${FORMS_PATH}/${id}`, {method: 'PATCH', body: {title}}),
    onSuccess: () => queryClient.invalidateQueries({queryKey: formsKey}),
  });
}

export function useDeleteForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({id, confirmTitle}: {id: string; confirmTitle: string}) =>
      api(`${FORMS_PATH}/${id}`, {method: 'DELETE', body: {confirmTitle}}),
    onSuccess: () => queryClient.invalidateQueries({queryKey: formsKey}),
  });
}

export function useSaveAsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({id, ...input}: SaveAsTemplateInput & {id: string}) =>
      api<TemplateSummary>(`${FORMS_PATH}/${id}/save-as-template`, {method: 'POST', body: input}),
    onSuccess: () => queryClient.invalidateQueries({queryKey: templatesKey}),
  });
}

const VIEW_KEY = 'intelform.forms.view';

function readLocalView(): FormsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function writeLocalView(v: FormsView) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Storage blocked: the server copy is enough.
  }
}

/**
 * Grid or list, remembered per user on the server (`/site-api/forms/prefs/view`). This browser's
 * copy gives the first paint, and the fallback when the server can't be reached.
 */
export function useFormsView(): [FormsView, (v: FormsView) => void] {
  const queryClient = useQueryClient();
  const [initial] = useState<FormsView>(readLocalView);
  const [chosen, setChosen] = useState<FormsView | null>(null);
  const server = useQuery(formsViewQuery);
  const save = useMutation({
    mutationFn: (v: FormsView) => api<FormsViewResponse>(`${FORMS_PATH}/prefs/view`, {method: 'PATCH', body: {view: v}}),
    onSuccess: data => queryClient.setQueryData(formsViewQuery.queryKey, data),
  });

  function change(v: FormsView) {
    setChosen(v);
    writeLocalView(v);
    save.mutate(v);
  }
  const view = chosen ?? server.data?.view ?? initial;
  return [view, change];
}

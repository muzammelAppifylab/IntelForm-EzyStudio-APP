import {queryOptions} from '@tanstack/react-query';

import {
  BUILDER_API,
  type BuilderCapabilities,
  type WebhookDelivery,
} from '../../../../lib/intelform/api-builder';
import {api} from '../../lib/api';

/**
 * Reads behind the builder's Settings and Share tabs. Keys sit under ['intelform', 'builder'],
 * so a builder-wide invalidation refreshes them too.
 */

export const capabilitiesQuery = queryOptions({
  queryKey: ['intelform', 'builder', 'capabilities'],
  queryFn: () => api<BuilderCapabilities>(`${BUILDER_API}/capabilities`),
  staleTime: 60_000,
});

/** Someone who can be emailed about new responses (has site:response:read). */
export interface Teammate {
  id: number;
  name: string;
  /** Not sent by the server (another user's address stays private); kept optional for the UI. */
  email?: string;
  /** The site owner: picking nobody sends to them. */
  owner: boolean;
}

/** GET /site-api/builder/teammates (FORM_WRITE): the people "Who gets it" lists. */
export const teammatesQuery = queryOptions({
  queryKey: ['intelform', 'builder', 'teammates'],
  queryFn: () => api<{members: Teammate[]}>(`${BUILDER_API}/teammates`),
  staleTime: 60_000,
  retry: false,
});

const webhookBase = (formId: string) => `${BUILDER_API}/forms/${encodeURIComponent(formId)}/webhook`;
export const webhookKey = (formId: string) => ['intelform', 'builder', 'webhook', formId] as const;

export const webhookInfoQuery = (formId: string) =>
  queryOptions({
    queryKey: [...webhookKey(formId), 'info'],
    queryFn: () => api<{hasSecret: boolean}>(webhookBase(formId)),
  });

export type DeliveryRow = WebhookDelivery & {pending?: boolean};

export const webhookLogQuery = (formId: string) =>
  queryOptions({
    queryKey: [...webhookKey(formId), 'log'],
    queryFn: () => api<{deliveries: DeliveryRow[]}>(`${webhookBase(formId)}/deliveries`),
    // Deliveries run as background jobs: while one is on its way, look again shortly.
    refetchInterval: query => (query.state.data?.deliveries.some(d => d.pending) ? 3000 : false),
  });

export const webhookPath = webhookBase;

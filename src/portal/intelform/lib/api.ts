import {siteFetch} from '../../../platform/browser';

/**
 * IntelForm's fetch helper for the dashboard and the builder. Every call goes to the Site API
 * (`/site-api/...`) through the template's `siteFetch`, which sends the CSRF header on writes and
 * refreshes an expired session once. Legacy `/api/X` paths map to `/site-api/X` (`sitePath`).
 *
 * Error bodies are read in both shapes the server may answer with:
 *   - the template's `problem()`: `{error: 'code', message, fields?}`
 *   - IntelForm's old shape:      `{error: {code, message, fields?, requestId?}}`
 * Field messages are normalised to `Record<string, string[]>` so forms can show the first one.
 */

export const SITE_API = '/site-api';

/** `/api/forms` → `/site-api/forms`; a path already under `/site-api` (or relative) is kept. */
export function sitePath(path: string): string {
  if (path.startsWith(`${SITE_API}/`) || path === SITE_API) return path;
  if (path.startsWith('/api/')) return `${SITE_API}${path.slice(4)}`;
  if (path.startsWith('/')) return `${SITE_API}${path}`;
  return path;
}

export type FieldMessages = Record<string, string[] | undefined>;

/** The error body after normalising either shape. */
export interface ApiErrorInfo {
  code: string;
  message: string;
  fields?: FieldMessages;
  requestId?: string;
}

/** An error the API answered with. `fields` holds per-input messages for 422s. Status 0 = offline. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldMessages;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorInfo) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
    this.requestId = body.requestId;
  }
}

function normaliseFields(raw: unknown): FieldMessages | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: FieldMessages = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = [v];
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
  }
  return out;
}

/** Reads either error shape; `fallback` when the body says nothing useful. */
export function parseErrorBody(data: unknown, fallback = 'Something went wrong. Try again.'): ApiErrorInfo {
  if (data && typeof data === 'object') {
    const d = data as {error?: unknown; message?: unknown; fields?: unknown; requestId?: unknown};
    if (d.error && typeof d.error === 'object') {
      const e = d.error as {code?: unknown; message?: unknown; fields?: unknown; requestId?: unknown};
      return {
        code: typeof e.code === 'string' ? e.code : 'unknown',
        message: typeof e.message === 'string' && e.message ? e.message : fallback,
        fields: normaliseFields(e.fields),
        requestId: typeof e.requestId === 'string' ? e.requestId : undefined,
      };
    }
    if (typeof d.error === 'string' || typeof d.message === 'string') {
      return {
        code: typeof d.error === 'string' ? d.error : 'unknown',
        message: typeof d.message === 'string' && d.message ? d.message : fallback,
        fields: normaliseFields(d.fields),
        requestId: typeof d.requestId === 'string' ? d.requestId : undefined,
      };
    }
  }
  return {code: 'unknown', message: fallback};
}

export const OFFLINE_MESSAGE = 'Can’t reach the server. Check your connection and try again.';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiOptions {
  method?: Method;
  body?: unknown;
  headers?: Record<string, string>;
  keepalive?: boolean;
  signal?: AbortSignal;
  /** Message for a failed request whose body carries none. */
  fallbackMessage?: string;
  /** Message when the network is unreachable. */
  offlineMessage?: string;
}

/**
 * Fetches a Site API path with the session cookie. Throws `ApiRequestError` for any non-2xx
 * answer. `path` may be a legacy `/api/...` path; it is mapped to `/site-api/...`.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await siteFetch(sitePath(path), {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {...(options.body === undefined ? {} : {'Content-Type': 'application/json'}), ...options.headers},
      keepalive: options.keepalive,
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    // A superseded query (TanStack aborts it): not an outage.
    if (options.signal?.aborted) throw err;
    throw new ApiRequestError(0, {code: 'offline', message: options.offlineMessage ?? OFFLINE_MESSAGE});
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, parseErrorBody(data, options.fallbackMessage));
  return data as T;
}

/** Message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
}

/** The first message per field, for a form's `setServerErrors` / inline errors. */
export function firstFieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiRequestError)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(err.fields)) if (v?.[0]) out[k] = v[0];
  return out;
}

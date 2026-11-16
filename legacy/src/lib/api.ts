import type { ApiErrorBody } from '@shared/api'

/** An error the API answered with. `fields` holds per-input messages for 422s. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[] | undefined>

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message)
    this.status = status
    this.code = body.code
    this.fields = body.fields ?? {}
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Fetches /api/* with the session cookie. Throws ApiRequestError for any non-2xx answer. */
export async function api<T>(
  path: string,
  options: { method?: Method; body?: unknown; headers?: Record<string, string>; keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      keepalive: options.keepalive,
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (err) {
    // A superseded query (TanStack aborts it): not an outage.
    if (options.signal?.aborted) throw err
    throw new ApiRequestError(0, { code: 'offline', message: 'Can’t reach the server. Check your connection and try again.' })
  }

  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error ?? { code: 'unknown', message: 'Something went wrong. Try again.' }
    throw new ApiRequestError(res.status, error)
  }
  return data as T
}

/** Message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Try again.'
}

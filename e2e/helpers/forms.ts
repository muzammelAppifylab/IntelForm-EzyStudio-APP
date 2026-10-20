import { expect, type APIRequestContext } from '@playwright/test'
import { formDefinition, type FormDefinition } from '../../shared/form/definition'
import { originOf } from './auth'

/** Dashboard API shortcuts for specs (the request context must be signed in). */

export async function createFromTemplate(request: APIRequestContext, baseURL: string | undefined, templateSlug: string, title: string): Promise<{ id: string; slug: string }> {
  const res = await request.post('/api/forms', { headers: { origin: originOf(baseURL) }, data: { templateSlug, title } })
  expect(res.status(), await res.text()).toBe(201)
  return res.json()
}

export async function publish(request: APIRequestContext, baseURL: string | undefined, formId: string): Promise<void> {
  const res = await request.post(`/api/forms/${formId}/publish`, { headers: { origin: originOf(baseURL) }, data: {} })
  expect(res.status(), await res.text()).toBe(200)
}

/** The published definition, as a respondent gets it. */
export async function liveDefinition(request: APIRequestContext, slug: string): Promise<FormDefinition> {
  const res = await request.get(`/api/public/forms/${slug}`)
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { status: string; definition: unknown }
  expect(body.status).toBe('live')
  return formDefinition.parse(body.definition)
}

export interface ResponsesPage {
  total: number
  rows: { id: string; cells: Record<string, string> }[]
}

export async function responses(request: APIRequestContext, formId: string): Promise<ResponsesPage> {
  const res = await request.get(`/api/forms/${formId}/responses`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

/** A unique, readable suffix for titles (specs share one database). */
export const stamp = () => Date.now().toString(36)

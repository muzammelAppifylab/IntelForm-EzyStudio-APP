import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicForm, type Loaded } from './PublicForm'
import './respondent.css'

/**
 * Respondent entry (form.html). Deliberately tiny: no router, no query cache, no dashboard code.
 * In production the server inlines the form JSON as #__FORM__ (server/respondent/inline.ts), so
 * the form renders with no extra request; otherwise it is fetched.
 */
function readInlined(): Loaded | null {
  const el = document.getElementById('__FORM__')
  if (!el?.textContent) return null
  try {
    return JSON.parse(el.textContent) as Loaded
  } catch {
    return null
  }
}

// /f/:slug, or /form.html?slug=… when opening the entry directly in development.
const fromPath = /^\/f\/([^/?#]+)/.exec(location.pathname)?.[1]
const slug = decodeURIComponent(fromPath ?? new URLSearchParams(location.search).get('slug') ?? '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PublicForm slug={slug} initial={slug ? readInlined() : { status: 'missing' }} search={location.search} />
  </StrictMode>,
)

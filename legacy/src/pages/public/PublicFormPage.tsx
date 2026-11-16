import { useEffect } from 'react'
import { useLocation, useParams } from 'react-router'
import { PublicForm } from '@/respondent/PublicForm'

/**
 * Public form at /f/:slug inside the dashboard SPA (development, and production until the
 * separate form.html entry is built). Renders the same respondent component as form.html.
 */
export default function PublicFormPage() {
  const { slug = '' } = useParams()
  const { search } = useLocation()
  useEffect(() => {
    // Keep the on-screen keyboard from covering the form (Chrome Android).
    const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]')
    if (!meta || meta.content.includes('interactive-widget')) return
    const before = meta.content
    meta.content = `${before}, interactive-widget=resizes-content`
    return () => {
      meta.content = before
    }
  }, [])
  return <PublicForm key={slug} slug={slug} search={search} />
}

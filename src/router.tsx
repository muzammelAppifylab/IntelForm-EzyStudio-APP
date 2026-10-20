import { createBrowserRouter, type RouteObject } from 'react-router'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { RedirectIfSignedIn, RequireUser } from '@/components/layout/guards'
import NotFoundPage from '@/pages/NotFoundPage'
import { RouteError } from '@/pages/RouteError'

/** Lazy route helper: one chunk per page. */
const page = (load: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: () => load().then((m) => ({ Component: m.default })),
})

/**
 * Four areas, one app (PRD sitemap): public front page, public forms, login and setup, and
 * the private dashboard.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      // Public front page (the creator's forms hub) and legal pages
      { path: '/', ...page(() => import('@/pages/public/HomePage')) },
      { path: '/privacy', ...page(() => import('@/pages/public/LegalPage')) },
      { path: '/terms', ...page(() => import('@/pages/public/LegalPage')) },

      // Public form pages: respondents, no login
      { path: '/f/:slug', ...page(() => import('@/pages/public/PublicFormPage')) },

      // Login and setup: creator and team only, no public signup
      {
        element: <AuthLayout />,
        children: [
          {
            element: <RedirectIfSignedIn />,
            children: [
              { path: '/setup', ...page(() => import('@/pages/auth/SetupPage')) },
              { path: '/login', ...page(() => import('@/pages/auth/LoginPage')) },
              { path: '/forgot', ...page(() => import('@/pages/auth/ForgotPage')) },
              { path: '/reset/:token', ...page(() => import('@/pages/auth/ResetPage')) },
            ],
          },
          { path: '/invite/:token', ...page(() => import('@/pages/auth/InvitePage')) },
        ],
      },

      // Dashboard: Owner, Editor, Viewer
      {
        element: <RequireUser />,
        children: [
          {
            // Lazy so public form pages never download the sidebar and menus.
            ...page(() => import('@/components/layout/DashboardLayout')),
            children: [
              { path: '/dashboard', ...page(() => import('@/pages/dashboard/FormsPage')) },
              { path: '/dashboard/templates', ...page(() => import('@/pages/dashboard/TemplatesPage')) },
              { path: '/dashboard/front-page', ...page(() => import('@/pages/dashboard/FrontPageEditorPage')) },
              { path: '/dashboard/team', ...page(() => import('@/pages/dashboard/TeamPage')) },
              { path: '/dashboard/settings', ...page(() => import('@/pages/dashboard/SettingsPage')) },
              { path: '/dashboard/profile', ...page(() => import('@/pages/dashboard/ProfilePage')) },
            ],
          },
          // The builder is full-width with its own header, outside the sidebar layout.
          { path: '/dashboard/forms/:formId/:tab?', ...page(() => import('@/pages/builder/BuilderPage')) },
        ],
      },

      // Living design system (development builds only)
      ...(import.meta.env.DEV ? [{ path: '/design-system', ...page(() => import('@/pages/dev/DesignSystemPage')) }] : []),

      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

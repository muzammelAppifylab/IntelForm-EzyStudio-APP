/** The builder's five tabs; the tab lives in the URL (/dashboard/forms/:id/:tab). */
export const TABS = [
  { id: 'build', label: 'Build' },
  { id: 'design', label: 'Design' },
  { id: 'settings', label: 'Settings' },
  { id: 'share', label: 'Share' },
  { id: 'responses', label: 'Responses' },
] as const
export type TabId = (typeof TABS)[number]['id']

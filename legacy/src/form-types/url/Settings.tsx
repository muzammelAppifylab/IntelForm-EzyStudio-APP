import type { FieldSettingsProps } from '@/builder/type-ui'

/** URL has no extra settings. */
export default function UrlSettings(_props: FieldSettingsProps<'url'>) {
  return <p className="text-caption text-muted-foreground">Respondents enter a web address. “acme.com” is saved as “https://acme.com”.</p>
}

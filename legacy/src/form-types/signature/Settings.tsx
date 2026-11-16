import type { FieldSettingsProps } from '@/builder/type-ui'

/** Signature has no extra settings. */
export default function SignatureSettings(_props: FieldSettingsProps<'signature'>) {
  return <p className="text-caption text-muted-foreground">Respondents draw their signature with a mouse, finger or pen, and can clear it to try again. It is saved as an image.</p>
}

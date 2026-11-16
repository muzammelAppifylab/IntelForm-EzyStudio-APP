import { lazy, Suspense } from 'react'
import type { FieldRendererProps } from '@/respondent/types'
import { Group } from '@/respondent/ui'

const SignatureCanvas = lazy(() => import('@/respondent/lazy/SignatureCanvas'))

export default function SignatureRenderer(p: FieldRendererProps<'signature'>) {
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={p.field.required} legendClassName={p.large ? 'text-question-xl' : undefined}>
      <Suspense fallback={<div className="h-44 rounded-lg border border-input bg-paper-50" />}>
        <SignatureCanvas {...p} />
      </Suspense>
    </Group>
  )
}

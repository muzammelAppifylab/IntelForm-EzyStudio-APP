import {lazy, Suspense} from 'react';

import type {FieldRendererProps} from '../../respondent/types';
import {Group} from '../../respondent/ui';

const SignatureCanvas = lazy(() => import('./SignatureCanvas'));

export default function SignatureRenderer(p: FieldRendererProps<'signature'>) {
  return (
    <Group legend={p.legend} description={p.description} error={p.error} required={p.field.required} legendClassName={p.large ? 'rf-question-xl' : undefined}>
      <Suspense fallback={<div className="ft-signature-pad" />}>
        <SignatureCanvas {...p} />
      </Suspense>
    </Group>
  );
}

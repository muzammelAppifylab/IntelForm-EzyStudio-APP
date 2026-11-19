import {type ComponentProps, lazy, Suspense} from 'react';

import type {RichTextInput as Input} from './RichTextInput';

const Lazy = lazy(() => import('./RichTextInput').then(m => ({default: m.RichTextInput})));

/**
 * The rich text answer box, fetched only for a question with "Rich text answers" on: most forms
 * never download its editor and toolbar.
 */
export function RichTextInput(props: ComponentProps<typeof Input>) {
  return (
    <Suspense fallback={<div className="rf-field-loading" aria-busy="true" />}>
      <Lazy {...props} />
    </Suspense>
  );
}

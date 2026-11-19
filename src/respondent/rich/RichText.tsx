import {useMemo} from 'react';

import {sanitizeRichTextLite as sanitizeRichText} from '../../lib/intelform/form/rich-text-core';
import {cx} from '../util';
import './rich-text.css';

/**
 * Shows rich text (a description, a rich answer). The ONE place rich text becomes markup: the
 * HTML is sanitized here, right before rendering, whatever the caller already did.
 */
export function RichText({
  html,
  as: Tag = 'div',
  inline,
  id,
  className,
}: {
  html: string;
  as?: 'div' | 'span';
  /** Single-line content (a short text answer). */
  inline?: boolean;
  id?: string;
  className?: string;
}) {
  const clean = useMemo(() => sanitizeRichText(html, {inline}), [html, inline]);
  if (!clean) return null;
  return <Tag id={id} className={cx('rt-content', className)} dangerouslySetInnerHTML={{__html: clean}} />;
}

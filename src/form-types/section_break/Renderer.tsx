import type {FieldRendererProps} from '../../respondent/types';

/** Section breaks store nothing; the layouts render them as page titles or dividers. */
export default function SectionBreakRenderer(_props: FieldRendererProps<'section_break'>) {
  return null;
}

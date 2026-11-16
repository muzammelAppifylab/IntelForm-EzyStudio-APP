import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

/** Section break: its label and description are the page title and intro. */
export default function SectionBreakSettings(_props: FieldSettingsProps<'section_break'>) {
  return (
    <SettingsNote>
      Starts a new page in the section-by-section layout; the label is the page title. In the other layouts it shows as a divider with its title. A rule on a
      section break shows or hides the whole page.
    </SettingsNote>
  );
}

import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

/** Signature has no extra settings. */
export default function SignatureSettings(_props: FieldSettingsProps<'signature'>) {
  return (
    <SettingsNote>
      Respondents draw their signature with a mouse, finger or pen, and can clear it to try again. It is saved as an image.
    </SettingsNote>
  );
}

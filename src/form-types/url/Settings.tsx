import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

/** URL has no extra settings. */
export default function UrlSettings(_props: FieldSettingsProps<'url'>) {
  return <SettingsNote>Respondents enter a web address. “acme.com” is saved as “https://acme.com”.</SettingsNote>;
}

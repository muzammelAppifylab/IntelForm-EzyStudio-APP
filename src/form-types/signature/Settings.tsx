import {useQuery} from '@tanstack/react-query';

import {Note} from '../../portal/intelform/builder/controls';
import {capabilitiesQuery} from '../../portal/intelform/builder/settings/queries';
import type {FieldSettingsProps} from '../../portal/intelform/builder/type-ui';
import {SettingsNote} from '../_settings/LengthLimits';

/** Signature has no extra settings; it needs the app's file storage (signatures are saved as images). */
export default function SignatureSettings(_props: FieldSettingsProps<'signature'>) {
  const caps = useQuery(capabilitiesQuery);
  return (
    <>
      {caps.data?.storage === 'not_set_up' && (
        <Note tone="warning">
          File storage isn’t set up for this app, so signatures can’t be saved and this form can’t be submitted. Add storage on the
          dashboard’s Storage page, then turn it on for this app.
        </Note>
      )}
      <SettingsNote>
        Respondents draw their signature with a mouse, finger or pen, and can clear it to try again. It is saved as an image.
      </SettingsNote>
    </>
  );
}

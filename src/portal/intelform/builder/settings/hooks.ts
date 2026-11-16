import {useState} from 'react';

import type {FormStatusResponse} from '../../../../lib/intelform/api-forms';
import type {FormSettingsPatch} from '../../../../lib/intelform/form/settings';
import {useToast} from '../../../ui';
import {ApiRequestError, errorMessage} from '../../lib/api';
import {useBuilderStore, type BuilderStore} from '../store';
import {clearErrorsFor, settingsFieldErrors, type SettingErrors} from './logic';

/**
 * Saves a settings patch through the builder's autosave queue (settings aren't undoable).
 * Validation errors land on the setting that caused them (keys like `redirectUrl`,
 * `webhook.url`); anything else is a toast. Resolves true when it saved.
 */
export function useSettingsSave() {
  const store = useBuilderStore();
  const toast = useToast();
  const [errors, setErrors] = useState<SettingErrors>({});
  async function save(patch: FormSettingsPatch, success?: string): Promise<boolean> {
    setErrors(e => clearErrorsFor(e, patch));
    try {
      await store.getState().patchSettings(patch);
      if (success) toast.success(success);
      return true;
    } catch (err) {
      const fields = settingsFieldErrors(err instanceof ApiRequestError ? err.fields : undefined);
      if (Object.keys(fields).length) setErrors(e => ({...e, ...fields}));
      else toast.danger(errorMessage(err));
      return false;
    }
  }
  return {save, errors};
}

/** After close / reopen: take the server's revision so the next autosave isn't a conflict. */
export function applyStatus(store: BuilderStore, res: FormStatusResponse) {
  store.queue.rebase(res.revision);
  store.setState({settings: res.settings});
  store.getState().setMeta({status: res.status, hasUnpublished: res.hasUnpublished, responses: res.responses});
}

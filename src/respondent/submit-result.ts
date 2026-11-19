import {SYSTEM_LABELS} from '../lib/intelform/form/labels';
import {PublicApiError} from './api';
import type {SubmitResult} from './FormRenderer';

/**
 * What a failed submit shows: field errors on their fields (422), the closed screen (403
 * form_closed), the password gate again (401 locked), or a message with a Reload that keeps the
 * answers (409 version_unknown, page_expired). Kept apart from the components so it can be tested without a DOM.
 */
export function submitFailure(
  err: unknown,
  on: {onClosed: (message: string) => void; onLocked: () => void; reload: () => void},
  labels = SYSTEM_LABELS
): SubmitResult {
  if (!(err instanceof PublicApiError)) return {ok: false, errors: {}, message: labels.submitError};
  if (err.code === 'validation_failed' && Object.keys(err.fields).length) {
    return {ok: false, errors: Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v?.[0] ?? labels.invalid]))};
  }
  if (err.code === 'form_closed') on.onClosed(err.message);
  if (err.code === 'locked') on.onLocked();
  if (err.code === 'version_unknown') {
    // The form was republished and the server no longer accepts this version: offer a reload
    // that keeps the answers in memory.
    return {ok: false, errors: {}, message: labels.formUpdated, action: {label: labels.reload, run: on.reload}};
  }
  if (err.code === 'page_expired' || err.code === 'page_invalid') {
    // Open for over a day, or the visitor's network changed (or the site was updated) since the
    // page loaded: a reload fetches a fresh render token and keeps the answers.
    return {ok: false, errors: {}, message: labels.pageExpired, action: {label: labels.reload, run: on.reload}};
  }
  return {ok: false, errors: {}, message: err.status === 0 ? labels.submitError : err.message};
}


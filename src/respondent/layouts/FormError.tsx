import {smallButtonClass} from '../classes';
import {RIcon} from '../icons';
import type {FormErrorAction} from './context';

/** A submit-level error (network, closed, rate limit) near the submit button, with an optional action (Reload). */
export function SubmitError({message, action}: {message: string | null; action?: FormErrorAction | null}) {
  if (!message) return null;
  return (
    <div role="alert" className="rf-submit-error rf-text-body">
      <p className="rf-submit-error-text">
        <RIcon name="alert" className="rf-icon-sm" />
        <span>{message}</span>
      </p>
      {action && (
        <button type="button" data-variant="outline" onClick={action.run} className={smallButtonClass}>
          {action.label}
        </button>
      )}
    </div>
  );
}

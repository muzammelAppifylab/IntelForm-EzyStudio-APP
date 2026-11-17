import {useRef, useState} from 'react';
import {z} from 'zod';

import {ApiRequestError, errorMessage} from './api';

type FieldErrors = Record<string, string | undefined>;

/** What a field's control needs to be tied to its `Field` (label, hint, error). */
export type ControlProps = {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
};

/**
 * The ARIA wiring of one control inside a `Field` with the same `id`: the error line
 * (`<id>-error`) while there is one, otherwise the hint (`<id>-hint`) when the Field has one.
 * Matches the ids `Field` renders (src/portal/ui/form.tsx).
 */
export function controlProps(id: string, error: string | undefined, hint = false): ControlProps {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
}

/** The bit of `document` the focus helper needs (kept small so it can be tested in node). */
export type FocusableDocument = {
  getElementById(id: string): {focus(): void; compareDocumentPosition(other: never): number} | null;
};

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING

/**
 * Focuses the first control (in page order) whose field has an error, so a keyboard or
 * screen-reader user lands on it instead of staying on the Save button (AGENTS.md "Fields").
 * Returns the id it focused, or null.
 */
export function focusFirstInvalid(
  ids: Record<string, string>,
  errors: FieldErrors,
  doc: FocusableDocument | undefined = typeof document === 'undefined' ? undefined : (document as unknown as FocusableDocument)
): string | null {
  if (!doc) return null;
  const found = Object.entries(errors)
    .filter(([name, message]) => message && ids[name])
    .map(([name]) => ({id: ids[name]!, el: doc.getElementById(ids[name]!)}))
    .filter((x): x is {id: string; el: NonNullable<ReturnType<FocusableDocument['getElementById']>>} => x.el !== null);
  if (found.length === 0) return null;
  const first = found.reduce((best, x) => (x.el.compareDocumentPosition(best.el as never) & FOLLOWING ? x : best));
  first.el.focus();
  return first.id;
}

/**
 * Error state for small forms: validate with the same zod schema the server uses, then map
 * either local or API errors onto fields, with anything else as one form-level message.
 * (The template's `useForm` from `src/portal/ui` is the default for new screens; this keeps
 * IntelForm's zod-schema forms working without rewriting their schemas.)
 *
 * Wire each control with `{...errors.control('appName', 'as-app-name')}` (the same id as its
 * `Field`): it links the error / hint by `aria-describedby`, and a failed validate or a
 * server answer with field errors focuses the first wrong field.
 */
export function useFormErrors() {
  const [fields, setFields] = useState<FieldErrors>({});
  const [form, setForm] = useState<string | null>(null);
  const ids = useRef<Record<string, string>>({});

  function showFields(next: FieldErrors) {
    setFields(next);
    focusFirstInvalid(ids.current, next);
  }

  function validate<T extends z.ZodType>(schema: T, values: unknown): z.infer<T> | null {
    const result = schema.safeParse(values);
    if (result.success) {
      setFields({});
      setForm(null);
      return result.data;
    }
    const flat = z.flattenError(result.error);
    setForm(flat.formErrors[0] ?? null);
    showFields(
      Object.fromEntries(
        Object.entries(flat.fieldErrors).map(([k, v]) => [k, (v as string[] | undefined)?.[0]])
      )
    );
    return null;
  }

  function fromError(err: unknown) {
    if (err instanceof ApiRequestError && Object.keys(err.fields).length > 0) {
      setForm(null);
      showFields(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v?.[0]])));
    } else {
      setForm(errorMessage(err));
    }
  }

  /** The id and ARIA props of the control for field `name`; pass `hint` when its Field has one. */
  function control(name: string, id: string, options: {hint?: boolean} = {}): ControlProps {
    ids.current[name] = id;
    return controlProps(id, fields[name], options.hint);
  }

  /** Shows errors found by a check outside the schema, and focuses the first wrong field. */
  function setFieldErrors(next: FieldErrors) {
    setForm(null);
    showFields(next);
  }

  return {
    fields,
    form,
    validate,
    fromError,
    control,
    setFieldErrors,
    clear: () => {
      setFields({});
      setForm(null);
    },
  };
}

/** The same wiring for the kit's `Combobox`, which names its props differently. */
export function comboboxControl(props: ControlProps): {id: string; invalid: boolean; describedBy: string | undefined} {
  return {id: props.id, invalid: Boolean(props['aria-invalid']), describedBy: props['aria-describedby']};
}

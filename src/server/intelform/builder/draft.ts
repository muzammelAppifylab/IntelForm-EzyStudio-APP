import {blankDefinition, formDefinition, type FormDefinition} from '../../../lib/intelform/form/definition';
import {lintLogic, lintOnePerEmail, type LogicIssue} from '../../../lib/intelform/form/logic';
import {defaultFormSettings, formSettings, type FormSettings} from '../../../lib/intelform/form/settings';
import {defaultTheme, formTheme, type FormTheme} from '../../../lib/intelform/form/theme';
import {coreRegistry} from '../../../lib/intelform/form/types/registry';
import {BuilderError, zodFields} from './errors';

/**
 * Pure helpers for a form's draft, theme and settings (no database): what autosave accepts,
 * what publish checks, and how stored JSON is read back tolerantly.
 */

/**
 * Autosave accepts drafts mid-edit: a field missing some of its type's props gets that type's
 * defaults instead of being rejected. Anything still invalid is a 422.
 */
export function normalizeDraft(raw: unknown): FormDefinition {
  const first = formDefinition.safeParse(raw);
  if (first.success) return first.data;
  const second = formDefinition.safeParse(repairDraft(raw));
  if (second.success) return second.data;
  throw new BuilderError(422, 'invalid_input', 'The form couldn’t be saved: some fields are invalid', zodFields(second.error, 'draft'));
}

export function repairDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const base = blankDefinition() as unknown as Record<string, unknown>;
  const draft: Record<string, unknown> = {...base, ...(raw as Record<string, unknown>)};
  if (Array.isArray(draft.fields)) {
    draft.fields = draft.fields.map((f: unknown) => {
      if (!f || typeof f !== 'object') return f;
      const field = f as Record<string, unknown>;
      const core = (coreRegistry as Record<string, {defaultProps: () => unknown} | undefined>)[String(field.type)];
      if (!core) return field;
      const props = field.props && typeof field.props === 'object' ? field.props : {};
      return {required: false, label: '', ...field, props: {...(core.defaultProps() as object), ...props}};
    });
  }
  return draft;
}

/** A stored draft for reading: repaired, or a blank one when it can't be. */
export function repairOrBlank(raw: unknown): FormDefinition {
  try {
    return normalizeDraft(raw);
  } catch {
    return blankDefinition();
  }
}

export function parseTheme(raw: unknown): FormTheme {
  const result = formTheme.safeParse(raw);
  if (result.success) return result.data;
  throw new BuilderError(422, 'invalid_input', 'The design couldn’t be saved: check the theme settings', zodFields(result.error, 'theme'));
}

/** Stored settings, tolerant of old or partial rows. */
export function readSettings(raw: unknown): FormSettings {
  const result = formSettings.safeParse(raw);
  return result.success ? result.data : defaultFormSettings();
}

export function readTheme(raw: unknown): FormTheme {
  const result = formTheme.safeParse(raw);
  return result.success ? result.data : defaultTheme();
}

/** If-Match: "12", W/"12" or 12. Anything else means no revision check. */
export function ifMatchRevision(header: string | undefined | null): number | null {
  const m = header?.trim().match(/^(?:W\/)?"?(\d{1,9})"?$/);
  return m ? Number(m[1]) : null;
}

export function countFields(def: FormDefinition) {
  const fields = def.fields.filter(f => f.type !== 'section_break').length;
  const logicRules = def.fields.filter(f => !!f.logic).length;
  return {fields, logicRules};
}

export type PublishCheck =
  | {ok: true; definition: FormDefinition}
  | {ok: false; error: BuilderError};

/**
 * Everything Publish refuses, in the order the person fixes it: an invalid draft (422 with the
 * fields), a form with no questions (`empty_form`), then logic and setting issues
 * (`logic_issues` with `issues`, the list `lintLogic` / `lintOnePerEmail` give).
 */
export function publishCheck(rawDraft: unknown, rawSettings: unknown): PublishCheck {
  // Tolerant of rows written before a prop or screen existed, exactly as autosave is.
  const strict = formDefinition.safeParse(rawDraft);
  const parsed = strict.success ? strict : formDefinition.safeParse(repairDraft(rawDraft));
  if (!parsed.success) {
    return {
      ok: false,
      error: new BuilderError(422, 'invalid_input', 'Fix the highlighted fields before you publish', zodFields(parsed.error, 'draft')),
    };
  }
  const definition = parsed.data;
  if (countFields(definition).fields === 0) {
    return {ok: false, error: new BuilderError(422, 'empty_form', 'Add at least one question before you publish')};
  }
  const issues: LogicIssue[] = [...lintLogic(definition), ...lintOnePerEmail(definition, readSettings(rawSettings))];
  if (issues.length > 0) {
    return {
      ok: false,
      error: new BuilderError(422, 'logic_issues', 'Fix the logic rules listed before you publish', undefined, {issues}),
    };
  }
  return {ok: true, definition};
}

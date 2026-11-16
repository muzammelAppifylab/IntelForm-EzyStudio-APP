import {useId} from 'react';

import type {Condition, ConditionOp, FormField, LogicRule} from '../../../../lib/intelform/form/definition';
import {CONDITION_VALUE_INPUTS} from '../../../../form-types/settings';
import {Button, Combobox, Icon, IconButton, Select} from '../../../ui';
import {describeRule, OP_MENU_LABEL} from '../describe';
import {fieldName} from '../ops';
import {useBuilder, useBuilderStore} from '../store';
import type {ConditionValueComponent} from '../type-ui';
import {
  conditionProblem,
  logicSources,
  MAX_CONDITIONS,
  needsValue,
  newCondition,
  operatorsFor,
  ruleIssues,
  ruleSubject,
  withOperator,
  withValue,
} from './model';
import {Note} from './parts';

/**
 * Show/hide rule on the selected question (PRD "Logic"): one rule, conditions joined by ALL or
 * ANY, each comparing an earlier question with a value. The controls read as a sentence
 * ("Show this question when all of these are true:"), and the plain-words summary sits under it.
 */
export function LogicEditor({field, index}: {field: FormField; index: number}) {
  const store = useBuilderStore();
  const draft = useBuilder(s => s.doc.draft);
  const readOnly = useBuilder(s => s.readOnly);
  const sources = logicSources(draft, index);
  const rule = field.logic;
  const issues = ruleIssues(draft, field.id);
  const what = ruleSubject(field);

  const setRule = (recipe: (rule: LogicRule) => void, key?: string) =>
    store.getState().updateField(
      field.id,
      f => {
        if (f.logic) recipe(f.logic as LogicRule);
      },
      key,
      'Edit rule'
    );

  if (!rule) {
    if (!sources.length)
      return (
        <p className="if-panel-text">
          Rules use answers to questions above this one. Add a question above it, or move this {what} further down, to add a rule.
        </p>
      );
    return (
      <div className="if-panel-stack">
        <p className="if-panel-text">This {what} is always shown. Add a rule to show or hide it based on earlier answers.</p>
        {!readOnly && (
          <Button
            variant="secondary"
            size="sm"
            icon="git-branch"
            className="if-panel-fit"
            onClick={() =>
              store
                .getState()
                .updateField(
                  field.id,
                  f => void (f.logic = {action: 'show', match: 'all', conditions: [newCondition(sources.at(-1)!)]}),
                  undefined,
                  'Add rule'
                )
            }>
            Add a rule
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="if-panel-stack if-logic">
      <div className="if-logic-sentence">
        <Select
          aria-label="Show or hide"
          value={rule.action}
          disabled={readOnly}
          onChange={e => setRule(r => void (r.action = e.target.value as LogicRule['action']))}
          options={[
            {value: 'show', label: 'Show'},
            {value: 'hide', label: 'Hide'},
          ]}
        />
        <span>this {what} when</span>
        {rule.conditions.length > 1 ? (
          <>
            <Select
              aria-label="Match all or any"
              value={rule.match}
              disabled={readOnly}
              onChange={e => setRule(r => void (r.match = e.target.value as LogicRule['match']))}
              options={[
                {value: 'all', label: 'all'},
                {value: 'any', label: 'any'},
              ]}
            />
            <span>of these are true:</span>
          </>
        ) : (
          <span>this is true:</span>
        )}
      </div>

      <ol className="if-logic-conditions" aria-label="Conditions">
        {rule.conditions.map((c, ci) => (
          <ConditionRow
            key={ci}
            n={ci}
            condition={c}
            sources={sources}
            readOnly={readOnly}
            joiner={ci === 0 ? null : rule.match === 'all' ? 'and' : 'or'}
            onChange={(next, key) => setRule(r => void (r.conditions[ci] = next), key)}
            onRemove={rule.conditions.length > 1 ? () => setRule(r => void r.conditions.splice(ci, 1)) : undefined}
          />
        ))}
      </ol>

      {issues.map((issue, i) => (
        <Note key={i} tone="warning">
          {issue.message}
        </Note>
      ))}

      {!readOnly && (
        <div className="if-panel-row">
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={rule.conditions.length >= MAX_CONDITIONS}
            onClick={() => setRule(r => void r.conditions.push(newCondition(sources.at(-1)!)))}>
            Add condition
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            onClick={() => store.getState().updateField(field.id, f => void delete f.logic, undefined, 'Remove rule')}>
            Remove rule
          </Button>
        </div>
      )}

      <p className="if-logic-summary">
        <Icon name="git-branch" size={14} />
        <span>{describeRule(draft, rule)}</span>
      </p>
    </div>
  );
}

function ConditionRow({
  n,
  condition,
  sources,
  readOnly,
  joiner,
  onChange,
  onRemove,
}: {
  n: number;
  condition: Condition;
  sources: FormField[];
  readOnly: boolean;
  joiner: string | null;
  onChange(c: Condition, key?: string): void;
  onRemove?: () => void;
}) {
  const draft = useBuilder(s => s.doc.draft);
  const questionId = useId();
  const src = sources.find(f => f.id === condition.field);
  const problem = conditionProblem(draft, sources, condition);
  const ops = operatorsFor(src);
  const Value = src ? (CONDITION_VALUE_INPUTS[src.type] as ConditionValueComponent | undefined) : undefined;
  const opKnown = ops.includes(condition.op);

  return (
    <li className="if-logic-condition">
      <div className="if-logic-condition-head">
        {joiner && <span className="if-logic-joiner">{joiner}</span>}
        <span className="visually-hidden">Condition {n + 1}</span>
        {onRemove && !readOnly && (
          <IconButton icon="x" size="sm" label={`Remove condition ${n + 1}`} className="if-logic-remove" onClick={onRemove} />
        )}
      </div>
      <label className="visually-hidden" htmlFor={questionId}>
        Question for condition {n + 1}
      </label>
      <Combobox
        id={questionId}
        value={src ? src.id : null}
        disabled={readOnly}
        invalid={!src}
        searchLabel="Find a question"
        emptyText="No question above this one matches."
        placeholder={
          problem?.kind === 'below' ? `${fieldName(draft, problem.field)} (now below, pick again)` : 'Deleted question, pick another'
        }
        options={sources.map(f => ({value: f.id, label: fieldName(draft, f)}))}
        onChange={id => {
          const next = sources.find(f => f.id === id);
          if (next) onChange(newCondition(next));
        }}
      />
      {src && (
        <div className="if-logic-compare">
          <Select
            aria-label={`Comparison for condition ${n + 1}`}
            value={opKnown ? condition.op : ''}
            disabled={readOnly}
            onChange={e => e.target.value && onChange(withOperator(condition, e.target.value as ConditionOp))}
            options={[...(opKnown ? [] : [{value: '', label: 'Comparison'}]), ...ops.map(op => ({value: op, label: OP_MENU_LABEL[op]}))]}
          />
          {needsValue(condition.op) && Value ? (
            <Value
              field={src as never}
              op={condition.op}
              value={condition.value}
              label={`Value for condition ${n + 1}`}
              readOnly={readOnly}
              onChange={value => onChange(withValue(condition, value), `cond:${n}:${condition.field}`)}
            />
          ) : (
            <span />
          )}
        </div>
      )}
      {!src && (
        <p className="if-logic-warning">
          <Icon name="warning" size={14} />
          Pick a question above this one.
        </p>
      )}
    </li>
  );
}

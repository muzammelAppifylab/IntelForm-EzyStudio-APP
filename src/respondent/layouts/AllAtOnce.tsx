import {type FormEvent, useEffect, useRef, useState} from 'react';

import {FieldBlock, fieldDomId, focusField} from '../FieldBlock';
import {RIcon} from '../icons';
import {RichText} from '../rich/RichText';
import {FormButton} from '../ui';
import {cx} from '../util';
import type {LayoutContext} from './context';
import {SubmitError} from './FormError';

/**
 * Every field on one page; section breaks are dividers with their title. Submit validates all
 * of it and shows an error summary at the top (GOV.UK pattern): focus moves to the summary,
 * whose links jump to each field, and the page title gets an "Error:" prefix.
 */
export function AllAtOnce({ctx}: {ctx: LayoutContext}) {
  const {engine, ttc, preview} = ctx;
  const {labels, def} = engine;
  const rootRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const ids = engine.pages.flat();
  const shown = ids.filter(id => engine.errors[id]);
  const hasSections = def.fields.some(f => f.type === 'section_break' && engine.visible.has(f.id));
  const showingErrors = attempt > 0 && shown.length > 0;

  useEffect(() => {
    if (attempt === 0) return;
    summaryRef.current?.focus({preventScroll: true});
    summaryRef.current?.scrollIntoView({block: 'start'});
  }, [attempt]);

  useEffect(() => {
    ctx.announce(null, {error: showingErrors});
    // The title follows whether errors are showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingErrors]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (ctx.submitting) return;
    const errs = engine.check(ids);
    engine.showErrors(errs);
    if (Object.keys(errs).length) return setAttempt(a => a + 1);
    const r = await ctx.submit();
    if (!r.ok && Object.keys(r.errors).length) setAttempt(a => a + 1);
  };

  return (
    <form ref={rootRef} noValidate onSubmit={onSubmit} className="rf-paged">
      <div className="rf-paged-body">
        {ctx.title && <h1 className={ctx.hideTitle ? 'rf-sr-only' : 'rf-question-xl rf-heading'}>{ctx.title}</h1>}
        {showingErrors && (
          <div ref={summaryRef} tabIndex={-1} aria-labelledby="if-error-summary" className="rf-error-summary">
            <h2 id="if-error-summary" className="rf-error-summary-title rf-question">
              <RIcon name="alert" />
              {labels.errorSummary}
            </h2>
            <ul className="rf-error-summary-list">
              {shown.map(id => (
                <li key={id}>
                  <a
                    href={`#${fieldDomId(id)}`}
                    onClick={e => {
                      e.preventDefault();
                      focusField(rootRef.current, id);
                    }}
                    className="rf-error-summary-link rf-text-body"
                  >
                    {engine.pipe(engine.field(id)?.label).trim() || labels.untitledQuestion} – {engine.errors[id]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {def.fields.map(f => {
          if (!engine.visible.has(f.id)) return null;
          if (f.type === 'section_break') {
            const title = engine.pipe(f.label).trim();
            const desc = engine.description(f);
            if (!title && !desc) return <hr key={f.id} className="rf-divider" />;
            return (
              <div key={f.id} className="rf-section">
                {title && <h2 className={cx('rf-question-xl rf-heading', f.hideLabel && 'rf-sr-only')}>{title}</h2>}
                {desc && <RichText html={desc} className="rf-text-answer rf-muted" />}
              </div>
            );
          }
          return <FieldBlock key={f.id} field={f} engine={engine} ttc={ttc} preview={preview} level={hasSections ? 3 : 2} onAnswered={ctx.markStarted} />;
        })}
        <SubmitError message={ctx.formError} action={ctx.formErrorAction} />
        <div>
          <FormButton type="submit" disabled={ctx.submitting} aria-busy={ctx.submitting || undefined}>
            {ctx.submitting ? labels.submitting : labels.submit}
          </FormButton>
        </div>
      </div>
    </form>
  );
}

import {type FormEvent, useEffect, useRef, useState} from 'react';

import {formatLabel} from '../../lib/intelform/form/labels';
import {FieldBlock, focusField} from '../FieldBlock';
import {RIcon} from '../icons';
import {FormButton, ProgressBar} from '../ui';
import {focusStep, type LayoutContext} from './context';
import {SubmitError} from './FormError';

/**
 * Section by section: one page per section break, its title and description on top, progress
 * "Step 2 of 4", Back / Next / Submit. Next validates the page and focuses the first invalid field.
 */
export function Paged({ctx}: {ctx: LayoutContext}) {
  const {engine, ttc, preview} = ctx;
  const {labels, pages} = engine;
  const [page, setPage] = useState(0);
  const p = Math.min(page, Math.max(0, pages.length - 1));
  const ids = pages[p] ?? [];
  const isLast = p >= pages.length - 1;
  const sectionId = engine.pageSections[p];
  const section = sectionId ? engine.field(sectionId) : undefined;
  const pageRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const pendingError = useRef<string | null>(null);

  useEffect(() => {
    ctx.announce(pages.length > 1 ? formatLabel(labels.step, {n: p + 1, total: pages.length}) : null);
    if (!moved.current) return;
    ctx.scrollTop();
    if (pendingError.current) {
      focusField(pageRef.current, pendingError.current, false);
      pendingError.current = null;
    } else focusStep(pageRef.current, false);
    // Once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  const goTo = (to: number) => {
    moved.current = true;
    setPage(to);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (ctx.submitting) return;
    const errs = engine.check(ids);
    engine.showErrors(errs, ids);
    const first = ids.find(id => errs[id]);
    if (first) return focusField(pageRef.current, first);
    if (!isLast) {
      ctx.playStep();
      return goTo(p + 1);
    }
    const r = await ctx.submit();
    if (r.ok) return;
    const errorId = pages.flat().find(id => r.errors[id]);
    if (!errorId) return;
    const at = pages.findIndex(pg => pg.includes(errorId));
    if (at === p) focusField(pageRef.current, errorId);
    else {
      pendingError.current = errorId;
      goTo(at);
    }
  };

  const sectionTitle = section ? engine.pipe(section.label).trim() : '';
  const sectionDesc = section ? engine.pipe(section.description).trim() : '';

  return (
    <form noValidate onSubmit={onSubmit} className="rf-paged">
      <div className="rf-paged-body rf-gap-lg">
        {ctx.title && <h1 className="rf-sr-only">{ctx.title}</h1>}
        {pages.length > 1 && <ProgressBar current={p + 1} total={pages.length} label={formatLabel(labels.step, {n: p + 1, total: pages.length})} />}
        <div ref={pageRef} className="rf-stack">
          {(sectionTitle || sectionDesc) && (
            <header className="rf-section-header">
              {sectionTitle && (
                <h2 tabIndex={-1} data-step-heading className="rf-question-xl rf-heading">
                  {sectionTitle}
                </h2>
              )}
              {sectionDesc && <p className="rf-text-answer rf-muted rf-pre-line">{sectionDesc}</p>}
            </header>
          )}
          {ids.map(id => {
            const f = engine.field(id);
            return f ? <FieldBlock key={id} field={f} engine={engine} ttc={ttc} preview={preview} level={sectionTitle ? 3 : 2} onAnswered={ctx.markStarted} /> : null;
          })}
        </div>
        <SubmitError message={ctx.formError} action={ctx.formErrorAction} />
        <div className="rf-nav-row">
          {p > 0 ? (
            <FormButton variant="outline" onClick={() => goTo(p - 1)} disabled={ctx.submitting}>
              <RIcon name="arrow-left" />
              {labels.back}
            </FormButton>
          ) : (
            <span />
          )}
          <FormButton type="submit" disabled={ctx.submitting} aria-busy={ctx.submitting || undefined}>
            {isLast ? (ctx.submitting ? labels.submitting : labels.submit) : labels.next}
            {!isLast && <RIcon name="arrow-right" />}
          </FormButton>
        </div>
      </div>
    </form>
  );
}

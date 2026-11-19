import type {FormsStrip, FormStatus, TemplateSummary} from '../../../lib/intelform/api-forms';
import {LAYOUT_LABEL, type Layout} from '../../../lib/intelform/form/definition';
import type {IconName, Tone} from '../../ui';

/**
 * Pure helpers for the forms list, the templates gallery and the overview (no React, no DOM):
 * numbers, labels, the weekly trend, the chart's scale. Unit-tested in tests/intelform/forms-ui.test.ts.
 */

/** Live first: the forms people check most. */
export const STATUS_ORDER: FormStatus[] = ['live', 'draft', 'closed'];

/** Each status as a badge tone, once for every screen (ui.md "STATUS_TONES"). */
export const STATUS_TONES: Record<FormStatus, Tone> = {live: 'success', draft: 'neutral', closed: 'warning'};

export const LAYOUT_ICON: Record<Layout, IconName> = {
  all_at_once: 'rows',
  section_by_section: 'layers',
  one_at_a_time: 'gallery-vertical',
};

export const layoutLabel = (layout: Layout | string): string => LAYOUT_LABEL[layout as Layout] ?? 'All at once';
export const layoutIcon = (layout: Layout | string): IconName => LAYOUT_ICON[layout as Layout] ?? 'rows';

/** 0.734 → "73%"; null (nobody started the form) → "—". */
export function formatRate(rate: number | null): string {
  return rate === null || !Number.isFinite(rate) ? '—' : `${Math.round(rate * 100)}%`;
}

const NUMBER = new Intl.NumberFormat('en-GB');
export function formatCount(n: number): string {
  return NUMBER.format(n);
}

/** "1 form", "3 forms". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Templates per category, in the server's category order, empty categories left out. */
export function groupByCategory(templates: TemplateSummary[], categories: string[]) {
  const known = new Set(categories);
  const order = [...categories, ...new Set(templates.map(t => t.category).filter(c => !known.has(c)))];
  return order
    .map(category => ({category, items: templates.filter(t => t.category === category)}))
    .filter(g => g.items.length > 0);
}

/** The create body for a template: built-ins by slug (they live in code), saved ones by id. */
export function templateInput(template?: TemplateSummary): {templateId?: string; templateSlug?: string} {
  if (!template) return {};
  return template.isBuiltin ? {templateSlug: template.slug} : {templateId: template.id};
}

/** The three templates suggested to a team with no forms yet (built-in slugs). */
export const SUGGESTED_TEMPLATES = ['builtin-lead-capture', 'builtin-contact-support', 'builtin-nps'];

export function suggestedTemplates(templates: TemplateSummary[] | undefined): TemplateSummary[] {
  if (!templates) return [];
  return SUGGESTED_TEMPLATES.map(slug => templates.find(t => t.slug === slug)).filter((t): t is TemplateSummary => !!t);
}

/** This week against last week, for a StatCard delta and its sentence. */
export function weekTrend(now: number, before: number): {
  trend: 'up' | 'down' | 'flat';
  value: string;
  sentence: string;
} {
  const diff = now - before;
  if (diff === 0) return {trend: 'flat', value: formatCount(now), sentence: `Same as last week (${formatCount(before)})`};
  if (before === 0) return {trend: 'up', value: `+${formatCount(diff)}`, sentence: 'Up from none last week'};
  const pct = Math.round((Math.abs(diff) / before) * 100);
  return {
    trend: diff > 0 ? 'up' : 'down',
    value: `${pct}%`,
    sentence: `${pct}% ${diff > 0 ? 'more' : 'fewer'} than last week`,
  };
}

/** Rounds the chart's top line up to 1, 2 or 5 × 10ⁿ (at least 4) so its labels stay readable. */
export function niceMax(n: number): number {
  if (!(n > 4)) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find(m => m * p >= n) ?? 10) * p;
}

/** "2024-05-03" → "Fri" (noon, so no time zone moves it to another day). */
export const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {weekday: 'short'});

/** The chart's text equivalent: "Responses per day: Mon 3, Tue 0, …, today 2". */
export function daysSummary(days: FormsStrip['days']): string {
  return `Responses per day: ${days.map((d, i) => `${i === days.length - 1 ? 'today' : weekday(d.date)} ${d.count}`).join(', ')}`;
}

/** Bar heights in chart units (0–100) for an SVG with a 100-unit tall plot; never 0 so the day shows. */
export function barHeights(days: FormsStrip['days']): {top: number; heights: number[]} {
  const top = niceMax(Math.max(0, ...days.map(d => d.count)));
  return {top, heights: days.map(d => Math.max(d.count ? 3 : 1.5, (d.count / top) * 100))};
}

/** The empty-result heading and line for a search / filter with no forms. */
export function noMatchText(search: string, status: FormStatus | 'all'): {title: string; body: string} {
  const label = status === 'all' ? '' : status;
  if (search === '' && status !== 'all') return {title: `No ${label} forms`, body: `You have no ${label} forms.`};
  if (search !== '') return {title: 'No forms match', body: 'Try another search, or clear the filters.'};
  return {title: 'No forms match', body: 'Nothing to show yet.'};
}

/** The public link of a form (works once published). */
export const publicFormUrl = (origin: string, slug: string) => `${origin}/f/${encodeURIComponent(slug)}/`;

/** The text that must be typed to delete a form. */
export const deleteMatches = (typed: string, title: string) => typed.trim() === title.trim();

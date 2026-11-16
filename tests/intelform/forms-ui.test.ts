import {describe, expect, it} from 'vitest';

import type {TemplateSummary} from '../../src/lib/intelform/api-forms';
import {
  barHeights,
  daysSummary,
  deleteMatches,
  formatRate,
  formsSubtitle,
  groupByCategory,
  layoutIcon,
  layoutLabel,
  niceMax,
  noMatchText,
  plural,
  publicFormUrl,
  suggestedTemplates,
  templateInput,
  weekTrend,
} from '../../src/portal/intelform/forms/format';
import {DEFAULT_FORMS_FILTER, formsListPath} from '../../src/portal/intelform/queries/forms';

const tpl = (over: Partial<TemplateSummary>): TemplateSummary => ({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'saved-x',
  name: 'X',
  category: 'Saved',
  description: '',
  isBuiltin: false,
  layout: 'all_at_once',
  fieldCount: 3,
  createdBy: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

describe('forms list helpers', () => {
  it('formats rates and plurals', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.734)).toBe('73%');
    expect(formatRate(1)).toBe('100%');
    expect(plural(1, 'form')).toBe('1 form');
    expect(plural(1200, 'form')).toBe('1,200 forms');
  });

  it('labels layouts, with a fallback for unknown ones', () => {
    expect(layoutLabel('one_at_a_time')).not.toBe('');
    expect(layoutIcon('section_by_section')).toBe('layers');
    expect(layoutIcon('weird')).toBe('rows');
    expect(layoutLabel('weird')).toBe('All at once');
  });

  it('builds the list path with defaults left out', () => {
    expect(formsListPath(DEFAULT_FORMS_FILTER)).toBe('/site-api/forms');
    expect(formsListPath({q: '  nps ', status: 'live', sort: 'title'}, 'abc')).toBe(
      '/site-api/forms?q=nps&status=live&sort=title&cursor=abc'
    );
    expect(formsListPath({q: 'a&b', status: 'all', sort: 'updated'})).toBe('/site-api/forms?q=a%26b');
  });

  it('words the empty result', () => {
    expect(noMatchText('', 'closed')).toEqual({title: 'No closed forms', body: 'You have no closed forms.'});
    expect(noMatchText('x', 'live').title).toBe('No forms match');
    expect(noMatchText('x', 'all').body).toMatch(/another search/);
  });

  it('says how many forms and how many are live', () => {
    expect(formsSubtitle(undefined)).toMatch(/Every form/);
    expect(formsSubtitle({all: 1, live: 0, draft: 1, closed: 0})).toBe('1 form · 0 live');
  });

  it('checks the typed title like the server (trimmed, exact)', () => {
    expect(deleteMatches('  Contact us ', 'Contact us')).toBe(true);
    expect(deleteMatches('contact us', 'Contact us')).toBe(false);
    expect(deleteMatches('', 'Contact us')).toBe(false);
  });

  it('links to the public form with a trailing slash', () => {
    expect(publicFormUrl('https://a.test', 'contact-us')).toBe('https://a.test/f/contact-us/');
  });
});

describe('week strip', () => {
  it('compares this week with last week', () => {
    expect(weekTrend(5, 5)).toMatchObject({trend: 'flat', sentence: 'Same as last week (5)'});
    expect(weekTrend(4, 0)).toMatchObject({trend: 'up', value: '+4', sentence: 'Up from none last week'});
    expect(weekTrend(15, 10)).toMatchObject({trend: 'up', value: '50%', sentence: '50% more than last week'});
    expect(weekTrend(5, 10)).toMatchObject({trend: 'down', value: '50%', sentence: '50% fewer than last week'});
  });

  it('rounds the chart top to a readable number', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(4)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
  });

  it('gives every day a visible bar and a text equivalent', () => {
    const days = [
      {date: '2024-05-01', count: 0},
      {date: '2024-05-02', count: 10},
      {date: '2024-05-03', count: 5},
    ];
    const {top, heights} = barHeights(days);
    expect(top).toBe(10);
    expect(heights).toEqual([1.5, 100, 50]);
    expect(daysSummary(days)).toBe('Responses per day: Wed 0, Thu 10, today 5');
  });
});

describe('templates', () => {
  it('groups by category in the server order, extra categories last, empty ones dropped', () => {
    const a = tpl({id: 'a', category: 'Feedback'});
    const b = tpl({id: 'b', category: 'Leads'});
    const c = tpl({id: 'c', category: 'Saved'});
    const groups = groupByCategory([a, b, c], ['Leads', 'Feedback', 'Events']);
    expect(groups.map(g => g.category)).toEqual(['Leads', 'Feedback', 'Saved']);
    expect(groups[1]!.items).toEqual([a]);
  });

  it('suggests the three first-run templates that exist', () => {
    const list = [tpl({slug: 'builtin-nps'}), tpl({slug: 'builtin-lead-capture'}), tpl({slug: 'other'})];
    expect(suggestedTemplates(list).map(t => t.slug)).toEqual(['builtin-lead-capture', 'builtin-nps']);
    expect(suggestedTemplates(undefined)).toEqual([]);
  });

  it('creates from a built-in by slug and from a saved template by id', () => {
    expect(templateInput()).toEqual({});
    expect(templateInput(tpl({isBuiltin: true, slug: 'builtin-nps'}))).toEqual({templateSlug: 'builtin-nps'});
    expect(templateInput(tpl({id: 'abc'}))).toEqual({templateId: 'abc'});
  });
});

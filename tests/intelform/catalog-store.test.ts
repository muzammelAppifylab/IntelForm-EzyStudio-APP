import {describe, expect, it, vi} from 'vitest';

import {EMPTY_CATALOG, entriesOf, finishCatalog, foldVersions, loadCatalog, mergeCatalog, parseFieldList, type StoredCatalog, type VersionFields} from '../../src/server/intelform/responses/catalog';
/** The catalog of these versions, as the app builds it (stored form, then entries). */
const buildCatalog = (versions: Parameters<typeof foldVersions>[1], published: string | null) => {
  const folded = foldVersions(EMPTY_CATALOG, versions, published, null);
  return entriesOf(finishCatalog(folded.cat, folded.published));
};

import {batchRows, checkEstimate, MAX_EXPORT_BYTES} from '../../src/server/intelform/exports/builders';
import {ExportError} from '../../src/server/intelform/exports/errors';

/** The precomputed responses catalog (form_catalogs) and the export's batch sizing. */

const choice = (id: string, label: string, opts: [string, string][], extra: Record<string, unknown> = {}) => ({
  id,
  type: 'single_choice',
  label,
  description: '<p>' + 'long help '.repeat(500) + '</p>',
  descriptionFormat: 'html',
  props: {options: opts.map(([oid, l]) => ({id: oid, label: l})), ...extra},
});
const text = (id: string, label: string) => ({id, type: 'short_text', label, props: {}});

const v1: VersionFields = {
  id: 'v1',
  version: 1,
  fields: [text('f_name0001', 'Name'), choice('f_pick0001', 'Colour', [['o_red0', 'Red'], ['o_blu0', 'Blue']]), text('f_gone0001', 'Old question')],
};
const v2: VersionFields = {
  id: 'v2',
  version: 2,
  fields: [
    {id: 's_break001', type: 'section_break', label: 'Page 2', props: {}},
    choice('f_pick0001', 'Favourite colour', [['o_red0', 'Red'], ['o_grn0', 'Green']]),
    text('f_name0001', 'Your name'),
    text('f_new00001', 'New question'),
  ],
};

describe('the stored catalog (merged at publish)', () => {
  it('keeps fields across versions: current in form order with the newest labels, then deleted ones', () => {
    const cat = entriesOf(mergeCatalog(mergeCatalog(null, parseFieldList(v1.fields)), parseFieldList(v2.fields)));
    expect(cat.entries.map(e => [e.meta.id, e.meta.label, e.meta.deleted])).toEqual([
      ['f_pick0001', 'Favourite colour', false],
      ['f_name0001', 'Your name', false],
      ['f_new00001', 'New question', false],
      ['f_gone0001', 'Old question (deleted)', true],
    ]);
    // Removed options stay for old answers, marked deleted; the current ones first.
    expect(cat.byId.get('f_pick0001')!.meta.options).toEqual([
      {id: 'o_red0', label: 'Red', deleted: false},
      {id: 'o_grn0', label: 'Green', deleted: false},
      {id: 'o_blu0', label: 'Blue (deleted option)', deleted: true},
    ]);
    expect((cat.byId.get('f_pick0001')!.plain.props as {options: {label: string}[]}).options.map(o => o.label)).toEqual(['Red', 'Green', 'Blue']);
  });

  it('is the same catalog as reading every version (the merge is a fold)', () => {
    const v3: VersionFields = {id: 'v3', version: 3, fields: [text('f_gone0001', 'Back again'), choice('f_pick0001', 'Colour', [['o_blu0', 'Blue']])]};
    const folded = [v1, v2, v3].reduce<StoredCatalog | null>((c, v) => mergeCatalog(c, parseFieldList(v.fields)), null)!;
    const viaRebuild = foldVersions(EMPTY_CATALOG, [v3, v1, v2], 'v3', null);
    expect(finishCatalog(viaRebuild.cat, viaRebuild.published)).toEqual(folded);
    const cat = buildCatalog([v3, v2, v1], 'v3');
    expect(cat.entries.map(e => [e.meta.id, e.meta.deleted])).toEqual([
      ['f_gone0001', false],
      ['f_pick0001', false],
      ['f_name0001', true],
      ['f_new00001', true],
    ]);
    // A deleted field keeps its newest label; options are the union, newest first.
    expect(cat.byId.get('f_name0001')!.meta.label).toBe('Your name (deleted)');
    expect(cat.byId.get('f_pick0001')!.meta.options!.map(o => o.id)).toEqual(['o_blu0', 'o_red0', 'o_grn0']);
  });

  it('keeps options across a type change and back', () => {
    const asText: VersionFields = {id: 'v2', version: 2, fields: [text('f_pick0001', 'Colour')]};
    const back: VersionFields = {id: 'v3', version: 3, fields: [choice('f_pick0001', 'Colour', [['o_grn0', 'Green']])]};
    const cat = buildCatalog([back, asText, v1], 'v3');
    expect(cat.byId.get('f_pick0001')!.meta.options!.map(o => [o.id, o.deleted])).toEqual([
      ['o_grn0', false],
      ['o_red0', true],
      ['o_blu0', true],
    ]);
  });

  it('a published version that is not the newest decides what is current', () => {
    const cat = buildCatalog([v2, v1], 'v1');
    expect(cat.entries.filter(e => !e.meta.deleted).map(e => e.meta.label)).toEqual(['Name', 'Colour', 'Old question']);
    expect(cat.byId.get('f_new00001')!.meta.deleted).toBe(true);
    // Nothing published: every field is a past one.
    expect(buildCatalog([v2, v1], null).entries.every(e => e.meta.deleted)).toBe(true);
  });

  it('stores only what readers use: no descriptions', () => {
    const stored = mergeCatalog(null, parseFieldList(v1.fields));
    const json = JSON.stringify(stored);
    expect(json).not.toContain('long help');
    expect(json).not.toContain('descriptionFormat');
    expect(Object.keys(stored.fields[0]!.f).sort()).toEqual(['id', 'label', 'props', 'required', 'type']);
  });

  it('500 fields × 200 versions merge in O(fields) a publish', () => {
    const fields = Array.from({length: 500}, (_, i) => choice(`f_${String(i).padStart(6, '0')}`, `Q${i}`, [['o_a', 'A']]));
    let cat: StoredCatalog | null = null;
    const parsed = parseFieldList(fields);
    const t = performance.now();
    for (let v = 0; v < 200; v++) cat = mergeCatalog(cat, parsed);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(cat!.fields).toHaveLength(500);
  });
});

describe('loadCatalog', () => {
  it('reads ONE row when the stored catalog is for the published version', async () => {
    const stored = mergeCatalog(null, parseFieldList(v2.fields));
    const queryRaw = vi.fn(async () => [
      {id: 'form-1', title: 'Survey', slug: 'survey', published_version_id: 'v2', response_count: 7, catalog: stored},
    ]);
    const executeRaw = vi.fn();
    const cat = await loadCatalog({$queryRaw: queryRaw, $executeRaw: executeRaw} as never, '00000000-0000-4000-8000-000000000001');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(cat!.form).toMatchObject({id: 'form-1', responseCount: 7, publishedVersionId: 'v2'});
    expect(cat!.entries.map(e => e.meta.id)).toEqual(['f_pick0001', 'f_name0001', 'f_new00001']);
  });

  it('rebuilds a missing catalog from the versions (batched, oldest first) and stores it', async () => {
    const answers: unknown[][] = [
      [{id: 'form-1', title: 'Survey', slug: 'survey', published_version_id: 'v2', response_count: 0, catalog: null}],
      [v1, v2],
    ];
    const queryRaw = vi.fn(async () => answers.shift() ?? []);
    const executeRaw = vi.fn(async () => 1);
    const cat = await loadCatalog({$queryRaw: queryRaw, $executeRaw: executeRaw} as never, '00000000-0000-4000-8000-000000000001');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(cat!.entries.map(e => [e.meta.id, e.meta.deleted])).toEqual(buildCatalog([v2, v1], 'v2').entries.map(e => [e.meta.id, e.meta.deleted]));
  });

  it('a catalog that could not be stored is still answered', async () => {
    const answers: unknown[][] = [[{id: 'f', title: 'S', slug: 's', published_version_id: 'v1', response_count: 0, catalog: {v: 0}}], [v1]];
    const queryRaw = vi.fn(async () => answers.shift() ?? []);
    const executeRaw = vi.fn(async () => {
      throw new Error('relation does not exist');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cat = await loadCatalog({$queryRaw: queryRaw, $executeRaw: executeRaw} as never, '00000000-0000-4000-8000-000000000001');
    warn.mockRestore();
    expect(cat!.entries).toHaveLength(3);
  });
});

describe('export batches', () => {
  it('sizes a batch from the form width', () => {
    expect(batchRows(1)).toBe(500);
    expect(batchRows(50)).toBe(500);
    expect(batchRows(100)).toBe(250);
    expect(batchRows(500)).toBe(50);
    expect(batchRows(5000)).toBe(50);
  });

  it('refuses an export that cannot fit, from its first batch', () => {
    // 1 KB a row: a million rows is ~1 GB.
    expect(() => checkEstimate(100, 500 * 1024, 500, 1_000_000, 'This export')).toThrow(ExportError);
    expect(() => checkEstimate(100, 500 * 1024, 500, 1_000_000, 'This export')).toThrow(/about 977 MB.*512 MB/);
    expect(() => checkEstimate(100, 500 * 1024, 500, 100_000, 'This export')).not.toThrow();
    expect(MAX_EXPORT_BYTES).toBe(512 * 1024 * 1024);
  });
});

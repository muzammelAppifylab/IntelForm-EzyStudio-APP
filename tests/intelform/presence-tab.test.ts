import {beforeEach, describe, expect, it, vi} from 'vitest';

/**
 * The builder's presence id is per browser TAB: a reload keeps it (so the old page's row is this
 * tab, never "You, in another tab"), a duplicated tab does not.
 */
vi.mock('../../src/platform/browser', () => ({siteFetch: vi.fn()}));
vi.mock('../../src/platform/files-browser', () => ({putFile: vi.fn()}));

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** A fresh page load (new module state) with the given tab's sessionStorage. */
async function loadPage(storage: Storage) {
  vi.resetModules();
  vi.stubGlobal('sessionStorage', storage);
  return import('../../src/portal/intelform/builder/lifecycle');
}

const FORM = '0b6f1b9e-3f2a-4c55-9a4e-2f1d6c7b8a90';

describe('builder presence tab id', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('keeps the same id across a reload of the same tab', async () => {
    const tab = memoryStorage();
    const first = await loadPage(tab);
    const id = first.claimTabId(FORM);
    expect(first.claimTabId(FORM)).toBe(id); // remount in the app: same id
    first.handOverTabId(FORM, id); // pagehide

    const reloaded = await loadPage(tab);
    expect(reloaded.claimTabId(FORM)).toBe(id);
  });

  it('gives a duplicated tab its own id', async () => {
    const tab = memoryStorage();
    const original = await loadPage(tab);
    const id = original.claimTabId(FORM);

    // "Duplicate tab" copies sessionStorage while the original is still open.
    const copy = memoryStorage();
    for (let i = 0; i < tab.length; i++) copy.setItem(tab.key(i)!, tab.getItem(tab.key(i)!)!);
    const duplicate = await loadPage(copy);
    expect(duplicate.claimTabId(FORM)).not.toBe(id);
  });

  it('ignores a malformed stored id and works without storage', async () => {
    const tab = memoryStorage();
    tab.setItem(`intelform:presence-tab:${FORM}`, 'bad id!');
    const page = await loadPage(tab);
    expect(page.claimTabId(FORM)).toMatch(/^[0-9a-f]{24}$/);

    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const noStorage = await loadPage(blocked);
    const id = noStorage.claimTabId(FORM);
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(() => noStorage.handOverTabId(FORM, id)).not.toThrow();
  });
});

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_KEYS, categoryOf} from '../src/lib/activity';
import {readActivitySearch} from '../src/portal/queries';

/** Every `.ts` / `.tsx` file under `dir`. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The actions the server writes: `audit(db, {action: 'x'})` and `logActivity(c, 'x')`. */
function writtenActions(): Set<string> {
  const found = new Set<string>();
  for (const file of [...files('src/server'), ...files('src/platform/auth')]) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/logActivity\(\s*c\s*,\s*'([a-z_]+)'/g)) found.add(m[1]!);
    for (const m of source.matchAll(/action:\s*'([a-z_]+)'/g)) found.add(m[1]!);
    for (const m of source.matchAll(/action:\s*[^'\n]*\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) {
      found.add(m[1]!);
      found.add(m[2]!);
    }
  }
  // Not audit actions: other `action:` keys in the auth code.
  found.delete('continue');
  return found;
}

describe('activity catalogue', () => {
  it('puts every action the server writes in exactly one group', () => {
    const seen = new Map<string, string>();
    for (const key of ACTIVITY_CATEGORY_KEYS) {
      for (const action of ACTIVITY_CATEGORIES[key].actions) {
        expect(seen.get(action), `${action} is in two groups`).toBeUndefined();
        seen.set(action, key);
      }
    }
    const missing = [...writtenActions()].filter(action => categoryOf(action) === null);
    expect(missing, 'add these to src/lib/activity.ts').toEqual([]);
  });
});

describe('activity URL filters', () => {
  it('keeps valid filters and drops anything odd', () => {
    expect(readActivitySearch({kind: 'forms', person: '12', from: '2026-11-01', to: '2026-11-18'})).toEqual({
      kind: 'forms',
      person: '12',
      from: '2026-11-01',
      to: '2026-11-18',
    });
    expect(readActivitySearch({size: '50'})).toEqual({size: '50'});
    expect(readActivitySearch({kind: 'Forms!', person: '0', from: 'yesterday', to: 5, size: '30'})).toEqual({});
    // An end before the start is dropped, not sent.
    expect(readActivitySearch({from: '2026-11-18', to: '2026-11-01'})).toEqual({from: '2026-11-18'});
  });
});

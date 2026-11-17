import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {isFreeEmailDomain} from '../src/server/intelform/respondent/validators';

/**
 * Install-script hygiene (audit finding F-053, docs/agent/security.md A03): only the packages
 * named in `allowScripts` may run an install script, each pinned to the version in the lockfile,
 * and no app dependency brings one of its own (free-email-domains' postinstall fetched its list
 * from the network; the list is vendored now).
 */
const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const pkg = read('package.json');
const lock = read('package-lock.json');

/** Lockfile packages that have an install script, as `name@version`. */
const withScripts = Object.entries(lock.packages as Record<string, {version?: string; hasInstallScript?: boolean}>)
  .filter(([path, meta]) => path && meta.hasInstallScript)
  .map(([path, meta]) => ({name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), version: meta.version}));

describe('install scripts', () => {
  it('every allowed script names the exact version the lockfile installs', () => {
    for (const [key, allowed] of Object.entries(pkg.allowScripts as Record<string, boolean>)) {
      if (!allowed) continue;
      const at = key.lastIndexOf('@');
      const [name, version] = [key.slice(0, at), key.slice(at + 1)];
      const installed = withScripts.find(p => p.name === name);
      expect(installed, `${key} in allowScripts has no install script in the lockfile`).toBeDefined();
      expect(installed!.version, `allowScripts pins ${key}, the lockfile installs ${installed!.version}`).toBe(version);
    }
  });

  it('no package with an install script is left out of allowScripts', () => {
    const named = new Set(Object.keys(pkg.allowScripts).map(k => (k.lastIndexOf('@') > 0 ? k.slice(0, k.lastIndexOf('@')) : k)));
    expect(withScripts.filter(p => !named.has(p.name)).map(p => `${p.name}@${p.version}`)).toEqual([]);
  });

  it('free-email-domains (network postinstall) is not a dependency', () => {
    expect(pkg.dependencies['free-email-domains']).toBeUndefined();
    expect(lock.packages['node_modules/free-email-domains']).toBeUndefined();
  });
});

describe('the vendored free-email-domain list', () => {
  it('knows the big providers and disposable ones, in any case', () => {
    for (const domain of ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'mailinator.com', 'GMail.COM', 'gmail.com.'])
      expect(isFreeEmailDomain(domain), domain).toBe(true);
  });

  it('lets business domains through', () => {
    for (const domain of ['example.com', 'acme.test', 'gmail.com.example.org', '']) expect(isFreeEmailDomain(domain), domain).toBe(false);
  });

  it('is a sorted list of lower-case domains with its license next to it', () => {
    const list: string[] = read('src/server/intelform/respondent/free-email-domains.json');
    expect(list.length).toBeGreaterThan(30_000);
    expect(list.every(d => d === d.toLowerCase() && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d))).toBe(true);
    expect([...list].sort()).toEqual(list);
    const license = readFileSync(fileURLToPath(new URL('../src/server/intelform/respondent/free-email-domains.LICENSE.md', import.meta.url)), 'utf8');
    expect(license).toContain('MIT');
  });
});

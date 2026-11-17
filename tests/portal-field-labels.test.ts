import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createElement, type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

/**
 * F-019: every `<label for>` on Your account names a real control (the Field's id and the
 * id `form.field()` gives the input are the same), and no id repeats on a tab.
 */

let tab = 'profile';
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSearch: () => ({tab}),
  useNavigate: () => () => undefined,
}));

const {Account} = await import('../src/portal/screens/account');
const {ConfirmProvider, Field, ToastProvider, useForm} = await import('../src/portal/ui');

function render(element: ReactElement, seed: (client: QueryClient) => void = () => {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
  seed(client);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      {client},
      createElement(ToastProvider, null, createElement(ConfirmProvider, null, element))
    )
  );
}

/** Every label's `for`, and every id with the tag it is on. */
function scan(html: string) {
  const fors = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(m => m[1]!);
  const ids = [...html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)].map(m => ({tag: m[1]!, id: m[2]!}));
  return {fors, ids};
}

function expectLabelsNameControls(html: string) {
  const {fors, ids} = scan(html);
  expect(fors.length).toBeGreaterThan(0);
  for (const target of fors) {
    const hit = ids.filter(x => x.id === target);
    expect(hit, `label for="${target}" has no element with that id`).toHaveLength(1);
    expect(['input', 'select', 'textarea', 'button'], `label for="${target}"`).toContain(hit[0]!.tag);
  }
  const seen = ids.map(x => x.id);
  expect(seen.filter((id, i) => seen.indexOf(id) !== i), 'repeated ids').toEqual([]);
}

const viewer = {state: 'user', id: 7, name: 'Pat', email: 'pat@example.test', emailVerified: true};
const seedAccount = (client: QueryClient) => {
  client.setQueryData(['me'], {viewer, access: {roles: [], permissions: []}});
  client.setQueryData(['account', 'two-factor'], {enabled: false, recoveryCodesLeft: 0, hasPassword: true});
  client.setQueryData(['account', 'sessions'], {sessions: []});
};

describe('Your account: labels name their fields (F-019)', () => {
  for (const name of ['profile', 'security', 'danger']) {
    it(`the ${name} tab`, () => {
      tab = name;
      const html = render(createElement(Account), seedAccount);
      expectLabelsNameControls(html);
      if (name === 'profile') {
        // The Change email form, which had no names at all.
        expect(html).toMatch(/<label for="f-changeEmail-email">New email address/);
        expect(html).toMatch(/<input[^>]*id="f-changeEmail-email"/);
        expect(html).toMatch(/<label for="f-changeEmail-password">Current password/);
        expect(html).toMatch(/<input[^>]*id="f-changeEmail-password"/);
      }
    });
  }
});

describe('useForm ids', () => {
  it('form.id(name) is the id field(name) gives its control, with or without idPrefix', () => {
    function Demo({prefix}: {prefix?: string}) {
      const form = useForm({email: ''}, {}, prefix ? {idPrefix: prefix} : {});
      // oxlint-disable-next-line react/no-children-prop -- createElement from a .ts test; children is a required prop
      return createElement(Field, {id: form.id('email'), label: 'Email', children: createElement('input', form.field('email'))});
    }
    for (const prefix of [undefined, 'x-']) {
      const html = render(createElement(Demo, {prefix}));
      const id = `${prefix ?? 'f-'}email`;
      expect(html).toContain(`<label for="${id}">`);
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"`));
    }
  });
});

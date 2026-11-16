import {describe, expect, it} from 'vitest';

import {
  clearErrorsFor,
  defaultCloseLocal,
  headerError,
  headersToSave,
  isRedirectUrl,
  isWebhookUrl,
  settingsFieldErrors,
  toggleRecipient,
  webhookSummary,
} from '../../src/portal/intelform/builder/settings/logic';

describe('settingsFieldErrors', () => {
  it('maps settings.* keys onto their setting and drops the vague ones', () => {
    expect(
      settingsFieldErrors({
        'settings.redirectUrl': ['Enter the link'],
        'settings.webhook.url': ['Private address'],
        settings: ['Check the settings'],
        slug: [],
        title: ['Too long'],
      })
    ).toEqual({redirectUrl: 'Enter the link', 'webhook.url': 'Private address', title: 'Too long'});
    expect(settingsFieldErrors(undefined)).toEqual({});
  });
});

describe('clearErrorsFor', () => {
  it('clears the touched settings, nested ones included', () => {
    const errors = {redirectUrl: 'x', 'webhook.url': 'y', seoTitle: 'z'};
    expect(clearErrorsFor(errors, {webhook: {enabled: true}})).toEqual({redirectUrl: 'x', seoTitle: 'z'});
    expect(clearErrorsFor(errors, {redirectUrl: null, afterSubmit: 'end_screen'})).toEqual({'webhook.url': 'y', seoTitle: 'z'});
  });
});

describe('links', () => {
  it('isRedirectUrl wants a safe http(s) link', () => {
    expect(isRedirectUrl('https://example.com/thanks')).toBe(true);
    expect(isRedirectUrl('  http://example.com  ')).toBe(true);
    expect(isRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isRedirectUrl('example.com')).toBe(false);
  });
  it('isWebhookUrl wants http(s) with a dotted host', () => {
    expect(isWebhookUrl('https://hooks.example.com/x')).toBe(true);
    expect(isWebhookUrl('https://localhost/x')).toBe(false);
    expect(isWebhookUrl('ftp://example.com')).toBe(false);
    expect(isWebhookUrl('')).toBe(false);
  });
});

describe('webhook headers', () => {
  it('headerError: empty rows are fine, bad names are not', () => {
    expect(headerError({key: '', value: ''})).toBeNull();
    expect(headerError({key: 'X-Api-Key', value: 'abc'})).toBeNull();
    expect(headerError({key: 'Bad Header', value: 'x'})).toMatch(/letters, digits and dashes/);
    expect(headerError({key: '', value: 'orphan'})).toMatch(/header name/i);
  });
  it('headersToSave drops blank rows, trims names, refuses while one is wrong', () => {
    expect(headersToSave([{key: ' X-A ', value: ' v '}, {key: '', value: ''}])).toEqual([{key: 'X-A', value: ' v '}]);
    expect(headersToSave([{key: 'X-A', value: '1'}, {key: 'bad name', value: '2'}])).toBeNull();
    expect(headersToSave([])).toEqual([]);
  });
  it('webhookSummary hides a redacted URL', () => {
    expect(webhookSummary({enabled: true, url: ''}, true)).toMatch(/an editor set up/);
    expect(webhookSummary({enabled: false, url: null}, true)).toBe('No webhook is set up.');
    expect(webhookSummary({enabled: true, url: 'https://h.example.com'}, false)).toBe('Responses are sent to https://h.example.com.');
    expect(webhookSummary({enabled: false, url: 'https://h.example.com'}, false)).toBe('No webhook is set up.');
  });
});

describe('misc', () => {
  it('defaultCloseLocal is a week ahead at 17:00', () => {
    expect(defaultCloseLocal(new Date(2026, 0, 28, 9, 30))).toBe('2026-02-04T17:00');
  });
  it('toggleRecipient adds once and removes', () => {
    expect(toggleRecipient([1], 2, true)).toEqual([1, 2]);
    expect(toggleRecipient([1, 2], 2, true)).toEqual([1, 2]);
    expect(toggleRecipient([1, 2], 1, false)).toEqual([2]);
  });
});

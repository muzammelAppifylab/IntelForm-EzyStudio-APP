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

describe('spam protection and embedding settings', () => {
  it('limits: defaults, bounds, and a day limit never below the hour', async () => {
    const {formSettings, formSettingsPatch, defaultFormSettings} = await import('../../src/lib/intelform/form/settings');
    expect(defaultFormSettings()).toMatchObject({spamIpPerHour: 5, spamIpPerDay: 20, spamFormPerMinute: 60, confirmPerHour: 100, embedOrigins: []});
    expect(formSettingsPatch.safeParse({spamIpPerHour: 1000}).success).toBe(true);
    expect(formSettingsPatch.safeParse({spamIpPerHour: 1001}).success).toBe(false);
    expect(formSettingsPatch.safeParse({spamIpPerHour: 0}).success).toBe(false);
    expect(formSettingsPatch.safeParse({spamFormPerMinute: 2.5}).success).toBe(false);
    const merged = formSettings.safeParse({...defaultFormSettings(), spamIpPerHour: 30, spamIpPerDay: 20});
    expect(merged.success).toBe(false);
    expect(merged.error?.issues[0]?.path).toEqual(['spamIpPerDay']);
  });

  it('allowed embedding sites: plain origins only, normalised', async () => {
    const {formSettingsPatch} = await import('../../src/lib/intelform/form/settings');
    const ok = formSettingsPatch.safeParse({embedOrigins: ['https://Shop.Example.com/', 'https://shop.example.com', 'http://localhost:4321']});
    expect(ok.success && ok.data.embedOrigins).toEqual(['https://shop.example.com', 'http://localhost:4321']);
    for (const bad of ['http://shop.example.com', 'https://shop.example.com/page', 'https://*.example.com', "https://a.example.com 'unsafe-inline'", 'javascript:alert(1)']) {
      expect(formSettingsPatch.safeParse({embedOrigins: [bad]}).success, bad).toBe(false);
    }
  });

  it('webhook headers: the signature headers and content-type are refused on save, any case', async () => {
    const {formSettingsPatch, webhookHeader} = await import('../../src/lib/intelform/form/settings');
    for (const key of ['Webhook-Signature', 'webhook-id', 'WEBHOOK-TIMESTAMP', 'webhook-anything', 'Content-Type', 'content-type']) {
      expect(formSettingsPatch.safeParse({webhook: {headers: [{key, value: 'x'}]}}).success, key).toBe(false);
      expect(headerError({key, value: 'x'})).toBe('The webhook sets this header itself. Use another name');
    }
    expect(formSettingsPatch.safeParse({webhook: {headers: [{key: 'Authorization', value: 'Bearer x'}]}}).success).toBe(true);
    // A row stored before this rule still reads (the delivery drops it), so no form loses its settings.
    expect(webhookHeader.safeParse({key: 'Content-Type', value: 'x'}).success).toBe(true);
  });
});

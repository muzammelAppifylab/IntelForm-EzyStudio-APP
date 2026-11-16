import {useQuery} from '@tanstack/react-query';
import {useMemo, useState} from 'react';

import {THEME_PRESETS} from '../../../lib/intelform/form/theme-core';
import {
  brandingSettingsInput,
  type ColorMode,
  DATE_FORMATS,
  type DateFormat,
  generalSettingsInput,
} from '../../../lib/intelform/settings-app';
import {type AppSettingsResponse, formatExample} from '../../../server/intelform/settings/view';
import {Button, Combobox, Field, RadioCards, Select, useToast} from '../../ui';
import {useFormErrors} from '../lib/form-errors';
import {settingsThemesQuery, useSaveAppSettings} from '../queries/app-settings';
import {ImageUpload, same, SettingsCard} from './bits';

/** Every IANA time zone this browser knows, UTC first. */
export function allTimeZones(): string[] {
  try {
    const zones = (Intl as unknown as {supportedValuesOf?: (key: string) => string[]}).supportedValuesOf?.('timeZone') ?? [];
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC'];
  }
}

export function GeneralGroup({view}: {view: AppSettingsResponse}) {
  const [v, setV] = useState(view.general);
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV(p => ({...p, [k]: value}));
  const zones = useMemo(() => {
    const list = allTimeZones();
    return (list.includes(v.timezone) ? list : [v.timezone, ...list]).map(tz => ({value: tz, label: tz.replaceAll('_', ' ')}));
  }, [v.timezone]);

  function submit() {
    const data = errors.validate(generalSettingsInput, v);
    if (!data) return;
    save.mutate(
      {general: data},
      {
        onSuccess: next => {
          setV(next.general);
          toast.success('General settings saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  return (
    <SettingsCard
      title="General"
      description="How the app introduces itself in the dashboard, on the public site and in emails."
      onSubmit={submit}
      dirty={!same(v, view.general)}
      saving={save.isPending}
      formError={errors.form}>
      <Field id="as-app-name" label="App name" hint="Shown in the sidebar, on the public site and in emails." error={errors.fields.appName}>
        <input
          id="as-app-name"
          value={v.appName}
          maxLength={60}
          aria-invalid={errors.fields.appName ? true : undefined}
          onChange={e => set('appName', e.target.value)}
        />
      </Field>
      <div className="settings-two-up">
        <ImageUpload label="Logo" purpose="logo" shape="square" value={v.logoUrl} onChange={url => set('logoUrl', url)} error={errors.fields.logoUrl} />
        <ImageUpload label="Favicon" purpose="favicon" shape="square" value={v.faviconUrl} onChange={url => set('faviconUrl', url)} error={errors.fields.faviconUrl} />
      </div>
      <Field id="as-timezone" label="Default time zone" hint="Used for close dates and response times." error={errors.fields.timezone}>
        <Combobox
          id="as-timezone"
          value={v.timezone}
          onChange={tz => set('timezone', tz)}
          options={zones}
          searchLabel="Search time zones"
          emptyText="No time zone matches."
          invalid={Boolean(errors.fields.timezone)}
        />
      </Field>
      <Field id="as-date-format" label="Date format" error={errors.fields.dateFormat}>
        <Select
          id="as-date-format"
          value={v.dateFormat}
          onChange={e => set('dateFormat', e.target.value as DateFormat)}
          options={DATE_FORMATS.map(f => ({value: f, label: `${formatExample(f)} (${f})`}))}
        />
      </Field>
    </SettingsCard>
  );
}

const MODE_OPTIONS: {value: ColorMode; title: string; description: string}[] = [
  {value: 'system', title: 'Follow the device', description: 'Light or dark, as each person’s device is set.'},
  {value: 'light', title: 'Light', description: 'Paper and ink.'},
  {value: 'dark', title: 'Dark', description: 'Easier on the eyes at night.'},
];
const DEFAULT_THEME = '__default';
const HEX = /^#[0-9a-fA-F]{6}$/;

export function BrandingGroup({view}: {view: AppSettingsResponse}) {
  const [v, setV] = useState(view.branding);
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const themes = useQuery(settingsThemesQuery);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV(p => ({...p, [k]: value}));

  const themeOptions = [
    {value: DEFAULT_THEME, label: 'IntelForm (default)', group: 'Built-in themes'},
    ...THEME_PRESETS.slice(1).map(t => ({value: t.id, label: `${t.name} (${t.mode})`, group: 'Built-in themes'})),
    ...(themes.data?.themes ?? []).map(t => ({value: t.id, label: t.name, group: 'Saved themes'})),
  ];
  // A saved theme the list hasn't loaded (or that was deleted) still shows by id.
  if (v.defaultThemeId && !themeOptions.some(o => o.value === v.defaultThemeId)) {
    themeOptions.push({value: v.defaultThemeId, label: themes.isPending ? 'Loading…' : 'A deleted theme', group: 'Saved themes'});
  }

  function submit() {
    const data = errors.validate(brandingSettingsInput, v);
    if (!data) return;
    save.mutate(
      {branding: data},
      {
        onSuccess: next => {
          setV(next.branding);
          toast.success('Branding saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  return (
    <SettingsCard
      title="Branding"
      description="The dashboard’s accent colour and mode, and the theme new forms start with."
      onSubmit={submit}
      dirty={!same(v, view.branding)}
      saving={save.isPending}
      formError={errors.form}>
      <Field
        id="as-accent"
        label="Dashboard accent colour"
        hint="Primary buttons and the active menu item. Leave empty for the default periwinkle."
        error={errors.fields.accentColor}>
        <div className="settings-color">
          <input
            type="color"
            className="settings-color-swatch"
            aria-label="Pick the accent colour"
            value={v.accentColor && HEX.test(v.accentColor) ? v.accentColor : '#C9C0FF'}
            onChange={e => set('accentColor', e.target.value.toUpperCase())}
          />
          <input
            id="as-accent"
            className="settings-color-hex"
            value={v.accentColor ?? ''}
            placeholder="#C9C0FF"
            maxLength={7}
            spellCheck={false}
            aria-invalid={errors.fields.accentColor ? true : undefined}
            onChange={e => set('accentColor', e.target.value.trim() ? e.target.value.trim() : null)}
          />
          {v.accentColor && (
            <Button size="sm" variant="ghost" onClick={() => set('accentColor', null)}>
              Use the default
            </Button>
          )}
        </div>
      </Field>
      <RadioCards
        legend="Default mode"
        name="as-default-mode"
        value={v.defaultMode}
        onChange={mode => set('defaultMode', mode)}
        options={MODE_OPTIONS}
        columns={3}
      />
      <Field
        id="as-default-theme"
        label="Default theme for new forms"
        hint="Each form can still change its theme in the Design tab."
        error={errors.fields.defaultThemeId}>
        <Combobox
          id="as-default-theme"
          value={v.defaultThemeId ?? DEFAULT_THEME}
          onChange={id => set('defaultThemeId', id === DEFAULT_THEME ? null : id)}
          options={themeOptions}
          searchLabel="Search themes"
          emptyText="No theme matches."
          invalid={Boolean(errors.fields.defaultThemeId)}
        />
      </Field>
    </SettingsCard>
  );
}

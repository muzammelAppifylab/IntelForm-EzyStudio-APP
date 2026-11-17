import {useState} from 'react';

import {legalSettingsInput, siteSettingsInput} from '../../../lib/intelform/settings-app';
import type {AppSettingsResponse} from '../../../server/intelform/settings/view';
import {Checkbox, Field, useToast} from '../../ui';
import {useFormErrors} from '../lib/form-errors';
import {useSaveAppSettings} from '../queries/app-settings';
import {ImageUpload, same, SettingsCard} from './bits';

/**
 * The public site (the forms hub): its pages and copy are code; only what has to change
 * without a deploy is here. Which forms it lists lives on each form (Share tab).
 */
export function SiteGroup({view}: {view: AppSettingsResponse}) {
  return (
    <div className="settings-stack">
      <SearchGroup view={view} />
      <LegalGroup view={view} />
    </div>
  );
}

function SearchGroup({view}: {view: AppSettingsResponse}) {
  const [v, setV] = useState(view.site);
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV(p => ({...p, [k]: value}));

  function submit() {
    const data = errors.validate(siteSettingsInput, v);
    if (!data) return;
    save.mutate(
      {site: data},
      {
        onSuccess: next => {
          setV(next.site);
          toast.success('Site details saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  return (
    <SettingsCard
      title="Site details"
      description="How visitors reach you, and how the public site appears in search results and link previews. The page title is the app name."
      onSubmit={submit}
      dirty={!same(v, view.site)}
      saving={save.isPending}
      formError={errors.form}>
      <Checkbox
        label="Let search engines index the public site"
        description="Off by default. Forms keep their own setting."
        checked={v.indexing}
        onChange={on => set('indexing', on)}
      />
      <Field id="as-contact-email" label="Contact email" optional hint="Shown on the public site so visitors can reach you. Leave empty to hide it." error={errors.fields.contactEmail}>
        <input
          {...errors.control('contactEmail', 'as-contact-email', {hint: true})}
          type="email"
          value={v.contactEmail}
          placeholder="hello@example.com"
          onChange={e => set('contactEmail', e.target.value)}
        />
      </Field>
      <Field id="as-description" label="Description" optional hint="For search results and link previews. About 150 characters works best." error={errors.fields.description}>
        <textarea
          {...errors.control('description', 'as-description', {hint: true})}
          rows={2}
          maxLength={300}
          value={v.description}
          onChange={e => set('description', e.target.value)}
        />
      </Field>
      <ImageUpload label="Social preview image" purpose="og" value={v.ogImage} onChange={url => set('ogImage', url)} error={errors.fields.ogImage} controlId={errors.control('ogImage', 'as-og-image').id} />
    </SettingsCard>
  );
}

function LegalGroup({view}: {view: AppSettingsResponse}) {
  const [v, setV] = useState(view.legal);
  const errors = useFormErrors();
  const save = useSaveAppSettings();
  const toast = useToast();

  function submit() {
    const data = errors.validate(legalSettingsInput, v);
    if (!data) return;
    // Only the text that changed: two long texts together may not fit one request.
    const patch = {
      ...(data.privacy !== view.legal.privacy ? {privacy: data.privacy} : {}),
      ...(data.terms !== view.legal.terms ? {terms: data.terms} : {}),
    };
    save.mutate(
      {legal: patch},
      {
        onSuccess: next => {
          setV(next.legal);
          toast.success('Privacy and terms saved.');
        },
        onError: err => errors.fromError(err),
      }
    );
  }

  return (
    <SettingsCard
      title="Privacy and terms"
      description="Shown at /privacy and /terms, and linked from the site footer when they have text. Plain text: blank lines start a new paragraph."
      onSubmit={submit}
      dirty={!same(v, view.legal)}
      saving={save.isPending}
      formError={errors.form}>
      <Field id="as-privacy" label="Privacy policy" optional error={errors.fields.privacy}>
        <textarea
          {...errors.control('privacy', 'as-privacy')}
          rows={8}
          value={v.privacy}
          onChange={e => setV(o => ({...o, privacy: e.target.value}))}
        />
      </Field>
      <Field id="as-terms" label="Terms" optional error={errors.fields.terms}>
        <textarea
          {...errors.control('terms', 'as-terms')}
          rows={8}
          value={v.terms}
          onChange={e => setV(o => ({...o, terms: e.target.value}))}
        />
      </Field>
    </SettingsCard>
  );
}

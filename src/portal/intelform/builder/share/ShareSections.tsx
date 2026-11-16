import {useMemo, useRef, useState} from 'react';

import {formSlug} from '../../../../lib/intelform/api-forms';
import {Button, buttonClass, CopyField, Field, Icon, Notice, Switch, useToast} from '../../../ui';
import {ApiRequestError, errorMessage} from '../../lib/api';
import {ImageField} from '../design/ImageField';
import {useCssVars} from '../design/theme-edit';
import {useSettingsSave} from '../settings/hooks';
import {ChoiceRow, SettingsCard, TextRow} from '../settings/shared';
import {useBuilder, useBuilderStore} from '../store';
import {useDraftText} from '../use-draft-text';
import {downloadHref, qrMatrix, qrPath, qrPngDataUrl, qrSvg} from './qr';
import {
  DEFAULT_EMBED,
  DEFAULT_POPUP_LABEL,
  embedSnippet,
  formUrl,
  popupSnippet,
  safeHex,
  shortUrl,
  type EmbedOptions,
} from './snippets';

const origin = () => location.origin;

// ---------------------------------------------------------------------- link --

export function LinkSection() {
  const store = useBuilderStore();
  const toast = useToast();
  const slug = useBuilder(s => s.meta.slug);
  const status = useBuilder(s => s.meta.status);
  const readOnly = useBuilder(s => s.readOnly);
  const [text, setText] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [shownSlug, setShownSlug] = useState(slug);
  if (shownSlug !== slug) {
    setShownSlug(slug);
    setText(slug);
  }
  const url = formUrl(origin(), slug);
  const dirty = text.trim().toLowerCase() !== slug;

  async function saveSlug() {
    const parsed = formSlug.safeParse(text);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the link');
    setSaving(true);
    try {
      await store.getState().patchSlug(parsed.data);
      setError(null);
      toast.success('Link changed. The old link still works.');
    } catch (err) {
      setError((err instanceof ApiRequestError && err.fields.slug?.[0]) || errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      id="link"
      title="Link"
      description={status === 'draft' ? 'The link works once you publish the form. Until then visitors see “not found”.' : undefined}
      actions={
        <a className={buttonClass({variant: 'secondary', size: 'sm'})} href={url} target="_blank" rel="noreferrer">
          <Icon name="external" size={16} />
          Open
        </a>
      }>
      <CopyField label="Form link" value={url} hint={status === 'draft' ? 'It works once you publish the form.' : undefined} />
      {!readOnly && (
        <form
          className="if-inline-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void saveSlug();
          }}>
          <Field
            id="if-slug"
            label="Custom link"
            error={error ?? undefined}
            hint="Letters, digits and hyphens. When you change it, the old link keeps working and redirects here.">
            <span className="if-slug-input">
              <span className="if-slug-prefix" aria-hidden="true">
                {location.host}/f/
              </span>
              <input
                id="if-slug"
                value={text}
                maxLength={60}
                spellCheck={false}
                autoCapitalize="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'if-slug-error' : 'if-slug-hint'}
                onChange={e => (setText(e.target.value), setError(null))}
              />
            </span>
          </Field>
          <Button type="submit" variant="secondary" disabled={!dirty} pending={saving} pendingLabel="Saving…">
            Save link
          </Button>
        </form>
      )}
    </SettingsCard>
  );
}

// ----------------------------------------------------------------------- seo --

export function SeoSection() {
  const settings = useBuilder(s => s.settings);
  const title = useBuilder(s => s.doc.title);
  const readOnly = useBuilder(s => s.readOnly);
  const {save, errors} = useSettingsSave();
  const seoTitle = useDraftText(settings.seoTitle, v => void save({seoTitle: v}));
  const seoDescription = useDraftText(settings.seoDescription, v => void save({seoDescription: v}));
  return (
    <SettingsCard id="seo" title="Search and social preview" description="How the link looks when shared in chats and social posts.">
      <TextRow label="Page title" maxLength={120} placeholder={title} disabled={readOnly} error={errors.seoTitle} {...seoTitle} />
      <TextRow
        label="Description"
        multiline
        maxLength={300}
        placeholder="One or two sentences about the form"
        disabled={readOnly}
        error={errors.seoDescription}
        {...seoDescription}
      />
      <ImageField
        label="Preview image"
        description="1200 × 630 works best. Without one, a card is made from the title and your theme."
        purpose="og"
        shape="og"
        value={settings.ogImage}
        disabled={readOnly}
        onChange={url => void save({ogImage: url})}
      />
      {errors.ogImage && <p className="field-error">{errors.ogImage}</p>}
      <Switch
        label="Hide from search engines"
        description="Asks Google and others not to list the form. On by default: most forms are shared by link."
        checked={settings.noindex}
        disabled={readOnly}
        onChange={v => void save({noindex: v})}
      />
    </SettingsCard>
  );
}

// --------------------------------------------------------------------- embed --

export function EmbedSection() {
  const slug = useBuilder(s => s.meta.slug);
  const title = useBuilder(s => s.doc.title);
  const [opts, setOpts] = useState<EmbedOptions>(DEFAULT_EMBED);
  const set = (patch: Partial<EmbedOptions>) => setOpts(o => ({...o, ...patch}));
  const code = embedSnippet(origin(), slug, title, opts);
  return (
    <SettingsCard
      id="embed"
      title="Embed in a page"
      description="Paste into any website. The form keeps its theme, and its height follows the content. Theme changes never need a new snippet.">
      <div className="if-two-cols">
        <ChoiceRow
          label="Width"
          value={opts.width}
          options={[
            {value: 'full', label: 'Full width'},
            {value: 'fixed', label: 'Fixed'},
          ]}
          onChange={width => set({width})}
        />
        {opts.width === 'fixed' ? (
          <TextRow label="Width in pixels" inputMode="numeric" value={opts.px} onChange={px => set({px})} />
        ) : (
          <span />
        )}
        <TextRow
          label="Starting height in pixels"
          hint="It grows to fit once loaded."
          inputMode="numeric"
          value={opts.height}
          onChange={height => set({height})}
        />
      </div>
      <Switch
        label="Transparent background"
        description="Lets your page show through behind the form."
        checked={opts.transparent}
        onChange={transparent => set({transparent})}
      />
      <Switch label="Hide the form title" checked={opts.hideTitle} onChange={hideTitle => set({hideTitle})} />
      <CopyField label="Embed code" value={code} multiline />
    </SettingsCard>
  );
}

// --------------------------------------------------------------------- popup --

export function PopupSection() {
  const slug = useBuilder(s => s.meta.slug);
  const themeButton = useBuilder(s => s.doc.theme.colors.button);
  const themeText = useBuilder(s => s.doc.theme.colors.buttonText);
  const [label, setLabel] = useState(DEFAULT_POPUP_LABEL);
  const [color, setColor] = useState<string | null>(null);
  const bg = safeHex(color ?? themeButton, themeButton);
  const fg = safeHex(themeText, '#FFFFFF');
  const code = popupSnippet(origin(), slug, {label, color: bg, textColor: fg});
  // The sample uses the creator's chosen colours: data, painted through the CSSOM.
  const sample = useRef<HTMLSpanElement>(null);
  useCssVars(sample, {'--sample-bg': bg, '--sample-fg': fg});

  return (
    <SettingsCard id="popup" title="Popup" description="A button on your page that opens the form in a window over it (full screen on phones).">
      <div className="if-two-cols">
        <TextRow label="Button label" value={label} maxLength={40} onChange={setLabel} />
        <div className="field">
          <label htmlFor="if-popup-color">Button colour</label>
          <span className="if-color-inline">
            <input id="if-popup-color" type="color" className="if-color-picker" value={bg.toLowerCase()} onChange={e => setColor(e.target.value.toUpperCase())} />
            <span className="if-mono">{bg}</span>
          </span>
        </div>
      </div>
      <div className="if-popup-sample">
        <span className="if-row-hint">Looks like</span>
        <span ref={sample} className="if-popup-sample-button">
          {label.trim() || 'Open form'}
        </span>
      </div>
      <CopyField label="Popup code" value={code} multiline />
    </SettingsCard>
  );
}

// ------------------------------------------------------------------------ qr --

export function QrSection() {
  const slug = useBuilder(s => s.meta.slug);
  const toast = useToast();
  const url = formUrl(origin(), slug);
  const qr = useMemo(() => {
    const m = qrMatrix(url);
    return {size: m.size, d: qrPath(m.data)};
  }, [url]);

  function download(kind: 'png' | 'svg') {
    const name = `form-${slug}-qr.${kind}`;
    try {
      if (kind === 'png') return downloadHref(qrPngDataUrl(url), name);
      const href = URL.createObjectURL(new Blob([qrSvg(url)], {type: 'image/svg+xml'}));
      downloadHref(href, name);
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (err) {
      toast.danger(errorMessage(err));
    }
  }

  return (
    <SettingsCard id="qr" title="QR code" description="For posters, flyers and slides. High error correction, so it still scans when printed small.">
      <div className="if-qr">
        <figure className="if-qr-figure">
          <svg
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            className="if-qr-code"
            role="img"
            aria-label={`QR code for ${url}`}
            shapeRendering="crispEdges">
            <rect width={qr.size} height={qr.size} fill="#FFFFFF" />
            <path d={qr.d} fill="#000000" />
          </svg>
          <figcaption className="if-mono">{shortUrl(url)}</figcaption>
        </figure>
        <div className="if-qr-actions">
          <Button variant="secondary" icon="download" onClick={() => download('png')}>
            Download PNG
          </Button>
          <Button variant="secondary" icon="download" onClick={() => download('svg')}>
            Download SVG
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------- front page --

export function FrontPageSection() {
  const settings = useBuilder(s => s.settings);
  const status = useBuilder(s => s.meta.status);
  const readOnly = useBuilder(s => s.readOnly);
  const {save, errors} = useSettingsSave();
  const description = useDraftText(settings.frontPageDescription, v => void save({frontPageDescription: v}));
  return (
    <SettingsCard id="front-page" title="Homepage" description="Your public site lists the forms you choose, by title. Only live forms appear.">
      <Switch
        label="Show on the homepage"
        checked={settings.showOnFrontPage}
        disabled={readOnly}
        onChange={v => void save({showOnFrontPage: v}, v ? 'Added to the homepage' : 'Removed from the homepage')}
      />
      {settings.showOnFrontPage && status !== 'live' && <Notice tone="info">It appears once the form is live.</Notice>}
      <TextRow
        label="Card description"
        multiline
        maxLength={300}
        placeholder="A sentence that tells visitors what the form is for"
        disabled={readOnly || !settings.showOnFrontPage}
        error={errors.frontPageDescription}
        {...description}
      />
    </SettingsCard>
  );
}

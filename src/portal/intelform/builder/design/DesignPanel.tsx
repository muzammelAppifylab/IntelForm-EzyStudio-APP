import {useState} from 'react';

import {THEME_PRESETS, themeContrastIssues, type FormTheme} from '../../../../lib/intelform/form/theme-core';
import {Icon, Notice, Slider} from '../../../ui';
import type {Draft} from '../../lib/produce';
import {useBuilder, useBuilderStore} from '../store';
import {ChoiceRow, TextRow} from '../settings/shared';
import {ColorField, DesignSection, FontSelect, PresetCard} from './bits';
import {ImageField} from './ImageField';
import {SavedThemes} from './SavedThemes';
import {applyPreset, COLOR_FIELDS} from './theme-edit';

type ThemeRecipe = (t: Draft<FormTheme>) => void;

/** Every theme edit is one undo step (coalesced by `key` while dragging or typing). */
function useThemeCommit() {
  const store = useBuilderStore();
  return (label: string, recipe: ThemeRecipe, key?: string) => store.getState().commit(label, d => void recipe(d.theme), key);
}

/** The Design tab's settings column: presets, colours, text, background, logo, buttons, saved themes. */
export function DesignPanel() {
  const theme = useBuilder(s => s.doc.theme);
  const readOnly = useBuilder(s => s.readOnly);
  const set = useThemeCommit();
  // "Image" picked but nothing uploaded yet: show the uploader; the theme stays solid until then.
  const [wantImage, setWantImage] = useState(false);
  const [lastImage, setLastImage] = useState<string | null>(null);
  const issues = themeContrastIssues(theme);

  return (
    <div className="if-design-panel">
      <DesignSection title="Presets" description="Picking one sets every option below. Your logo is kept.">
        <ul className="if-presets" aria-label="Theme presets">
          {THEME_PRESETS.map(p => (
            <li key={p.id}>
              <PresetCard
                preset={p}
                active={theme.preset === p.id}
                disabled={readOnly}
                onPick={() => set(`Apply ${p.name} theme`, t => void Object.assign(t, applyPreset(theme, p)))}
              />
            </li>
          ))}
        </ul>
      </DesignSection>

      <DesignSection title="Colours">
        {COLOR_FIELDS.map(c => (
          <ColorField
            key={c.key}
            label={c.label}
            help={c.help}
            value={theme.colors[c.key]}
            disabled={readOnly}
            warn={issues.some(i => i.key === c.key)}
            onChange={v =>
              set(
                'Change colour',
                t => {
                  t.colors[c.key] = v;
                  t.preset = null;
                },
                `theme:color:${c.key}`
              )
            }
          />
        ))}
        {issues.length > 0 ? (
          <div className="if-group" role="status">
            {issues.map(i => (
              <Notice key={i.key} tone="warning">
                {i.message}
              </Notice>
            ))}
            <p className="if-row-hint">Warnings don’t stop you publishing, but some people may struggle to read the form.</p>
          </div>
        ) : (
          <p className="if-contrast-ok" role="status">
            <Icon name="check" size={14} />
            Text and buttons meet WCAG AA contrast.
          </p>
        )}
      </DesignSection>

      <DesignSection title="Text">
        <FontSelect
          label="Font"
          value={theme.font}
          disabled={readOnly}
          onChange={f =>
            f &&
            set('Change font', t => {
              t.font = f;
              t.preset = null;
            })
          }
        />
        <FontSelect
          label="Question font"
          value={theme.questionFont}
          allowSame
          disabled={readOnly}
          onChange={f =>
            set('Change question font', t => {
              t.questionFont = f;
              t.preset = null;
            })
          }
        />
        <ChoiceRow
          label="Size"
          value={theme.fontSize}
          disabled={readOnly}
          options={[
            {value: 's', label: 'Small'},
            {value: 'm', label: 'Medium'},
            {value: 'l', label: 'Large'},
          ]}
          onChange={v => set('Change text size', t => void (t.fontSize = v))}
        />
        <ChoiceRow
          label="Alignment"
          description="One-at-a-time questions and the start and end screens."
          value={theme.alignment}
          disabled={readOnly}
          options={[
            {value: 'left', label: 'Left'},
            {value: 'center', label: 'Centre'},
          ]}
          onChange={v => set('Change alignment', t => void (t.alignment = v))}
        />
      </DesignSection>

      <DesignSection title="Background">
        <ChoiceRow
          label="Type"
          value={wantImage ? 'image' : theme.background.type}
          disabled={readOnly}
          options={[
            {value: 'solid', label: 'Solid colour'},
            {value: 'image', label: 'Image'},
          ]}
          onChange={v => {
            if (v === 'solid') {
              setWantImage(false);
              set('Use a solid background', t => void (t.background = {type: 'solid'}));
            } else if (lastImage) set('Use a background image', t => void (t.background = {type: 'image', imageUrl: lastImage, overlay: 40}));
            else setWantImage(true);
          }}
        />
        {(theme.background.type === 'image' || wantImage) && (
          <BackgroundImage
            readOnly={readOnly}
            onImage={url => {
              setLastImage(url);
              setWantImage(false);
            }}
          />
        )}
      </DesignSection>

      <DesignSection title="Logo" description="Shown at the top of every screen.">
        <ImageField
          label="Logo image"
          purpose="logo"
          shape="logo"
          value={theme.logo?.url}
          disabled={readOnly}
          onChange={url =>
            set(url ? 'Change logo' : 'Remove logo', t => void (t.logo = url ? {url, position: t.logo?.position ?? 'left', alt: t.logo?.alt} : null))
          }
        />
        {theme.logo && (
          <>
            <ChoiceRow
              label="Position"
              value={theme.logo.position}
              disabled={readOnly}
              options={[
                {value: 'left', label: 'Left'},
                {value: 'center', label: 'Centre'},
              ]}
              onChange={v => set('Move logo', t => void (t.logo && (t.logo.position = v)))}
            />
            <TextRow
              label="Logo description (alt text)"
              hint="Usually your organisation’s name."
              value={theme.logo.alt ?? ''}
              maxLength={200}
              disabled={readOnly}
              onChange={v => set('Edit logo text', t => void (t.logo && (t.logo.alt = v || undefined)), 'theme:logo:alt')}
            />
          </>
        )}
      </DesignSection>

      <DesignSection title="Buttons">
        <ChoiceRow
          label="Corners"
          value={theme.buttonRadius}
          disabled={readOnly}
          options={[
            {value: 'square', label: 'Square'},
            {value: 'rounded', label: 'Rounded'},
            {value: 'pill', label: 'Pill'},
          ]}
          onChange={v => set('Change button corners', t => void (t.buttonRadius = v))}
        />
      </DesignSection>

      <SavedThemes />
    </div>
  );
}

function BackgroundImage({readOnly, onImage}: {readOnly: boolean; onImage: (url: string) => void}) {
  const bg = useBuilder(s => s.doc.theme.background);
  const set = useThemeCommit();
  return (
    <>
      <ImageField
        label="Background image"
        purpose="image"
        value={bg.type === 'image' ? bg.imageUrl : null}
        disabled={readOnly}
        onChange={url => {
          if (url) onImage(url);
          set(
            url ? 'Set background image' : 'Remove background image',
            t => void (t.background = url ? {type: 'image', imageUrl: url, overlay: bg.type === 'image' ? bg.overlay : 40} : {type: 'solid'})
          );
        }}
      />
      {bg.type === 'image' && (
        <div className="if-group">
          <Slider
            label="Darken"
            min={0}
            max={80}
            step={5}
            value={bg.overlay}
            format={v => `${v}%`}
            disabled={readOnly}
            onChange={v => set('Change overlay', t => void (t.background.type === 'image' && (t.background.overlay = v)), 'theme:overlay')}
          />
          <p className="if-row-hint">Darkens the image so text stays readable. Contrast is checked against the background colour under it.</p>
        </div>
      )}
    </>
  );
}

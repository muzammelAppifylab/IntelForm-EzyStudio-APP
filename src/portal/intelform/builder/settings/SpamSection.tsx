import {Link} from '@tanstack/react-router';
import {useState} from 'react';

import {DAY_BELOW_HOUR, embedOrigin, FORM_LIMITS, type FormLimitKey, MAX_EMBED_ORIGINS} from '../../../../lib/intelform/spam';
import {Notice} from '../../../ui';
import {useCan} from '../../lib/can';
import {useBuilder} from '../store';
import {useSettingsSave} from './hooks';
import {Hint, SettingsCard, TextRow} from './shared';

/**
 * Settings → Spam protection: how many responses the form takes from one network and in all,
 * how many confirmation emails it sends, and which sites may embed it. Each limit saves as soon
 * as it is a valid number (like the response cap); a wrong one shows its error under the field
 * and saves nothing. The rules are the server's (src/lib/intelform/spam.ts).
 */

const LIMIT_FIELDS: {key: FormLimitKey; label: string; unit: string; hint?: string}[] = [
  {key: 'spamIpPerHour', label: 'Responses from one network, per hour', unit: 'an hour'},
  {key: 'spamIpPerDay', label: 'Responses from one network, per day', unit: 'a day'},
  {
    key: 'spamFormPerMinute',
    label: 'Responses from everyone, per minute',
    unit: 'a minute',
    hint: 'Past this, people are asked to wait a minute. You get an email when it happens (at most once an hour).',
  },
  {
    key: 'confirmPerHour',
    label: 'Confirmation emails, per hour',
    unit: 'an hour',
    hint: 'Past this, responses are still saved but get no confirmation email.',
  },
];

/** The message for a typed limit, or null when it can be saved. Mirrors the server's rules. */
export function limitError(key: FormLimitKey, text: string, others: {spamIpPerHour: number; spamIpPerDay: number}): string | null {
  const r = FORM_LIMITS[key];
  const t = text.trim();
  const range = `Enter a whole number from ${r.min} to ${r.max.toLocaleString('en')}`;
  if (!/^\d+$/.test(t)) return range;
  const n = Number(t);
  if (n < r.min || n > r.max) return range;
  if (key === 'spamIpPerDay' && n < others.spamIpPerHour) return DAY_BELOW_HOUR;
  if (key === 'spamIpPerHour' && n > others.spamIpPerDay) return 'Use an hourly limit no higher than the daily one';
  return null;
}

/** The embedding sites typed one per line → the list to save, or the first problem. */
export function parseEmbedOrigins(text: string): {list: string[]} | {error: string} {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length > MAX_EMBED_ORIGINS) return {error: `List ${MAX_EMBED_ORIGINS} sites or fewer`};
  const list: string[] = [];
  for (const line of lines) {
    const origin = embedOrigin(line);
    if (!origin) return {error: `“${line.slice(0, 60)}” isn’t a site address. Use one like https://example.com, without a page path`};
    if (!list.includes(origin)) list.push(origin);
  }
  return {list};
}

export function SpamSection() {
  const settings = useBuilder(s => s.settings);
  const readOnly = useBuilder(s => s.readOnly);
  const {save, errors} = useSettingsSave();
  const canSeeBlocks = useCan('manageAppSettings');
  const [text, setText] = useState<Record<FormLimitKey, string>>(() => ({
    spamIpPerHour: String(settings.spamIpPerHour),
    spamIpPerDay: String(settings.spamIpPerDay),
    spamFormPerMinute: String(settings.spamFormPerMinute),
    confirmPerHour: String(settings.confirmPerHour),
  }));
  const [touched, setTouched] = useState<Partial<Record<FormLimitKey, boolean>>>({});
  const [sites, setSites] = useState(settings.embedOrigins.join('\n'));
  const [sitesError, setSitesError] = useState<string | null>(null);

  const others = {spamIpPerHour: settings.spamIpPerHour, spamIpPerDay: settings.spamIpPerDay};

  function change(key: FormLimitKey, value: string) {
    setText(t => ({...t, [key]: value}));
    if (!limitError(key, value, others)) void save({[key]: Number(value.trim())});
  }

  function saveSites() {
    const parsed = parseEmbedOrigins(sites);
    if ('error' in parsed) return setSitesError(parsed.error);
    setSitesError(null);
    setSites(parsed.list.join('\n'));
    if (parsed.list.join('\n') !== settings.embedOrigins.join('\n')) void save({embedOrigins: parsed.list});
  }

  return (
    <SettingsCard
      id="spam"
      title="Spam protection"
      description="Limits that stop a bot from flooding this form, filling its response limit or sending emails through it.">
      <Notice tone="info">
        Schools, offices and cafés often share one network address, so everyone there counts as one visitor. If you share this form
        with a class or a team in one place, raise the limits per network before they start.
      </Notice>
      <div className="if-two-cols">
        {LIMIT_FIELDS.map(f => {
          const r = FORM_LIMITS[f.key];
          const own = limitError(f.key, text[f.key], others);
          return (
            <TextRow
              key={f.key}
              label={f.label}
              type="text"
              inputMode="numeric"
              value={text[f.key]}
              disabled={readOnly}
              hint={f.hint ?? `From ${r.min} to ${r.max.toLocaleString('en')} ${f.unit}. New forms start at ${r.default}.`}
              error={errors[f.key] ?? (touched[f.key] ? own : null)}
              onBlur={() => setTouched(t => ({...t, [f.key]: true}))}
              onChange={v => change(f.key, v.replace(/[^\d]/g, ''))}
            />
          );
        })}
      </div>
      <Hint>
        A network that keeps going over its limits is blocked for an hour, then a day, then a week.{' '}
        {canSeeBlocks ? (
          <Link to="/app-settings" search={{tab: 'spam'} as never}>
            See blocked visitors
          </Link>
        ) : (
          'An admin can see and unblock them in Settings.'
        )}
      </Hint>

      <TextRow
        label="Allowed embedding sites"
        multiline
        rows={3}
        maxLength={4200}
        placeholder="https://example.com"
        value={sites}
        disabled={readOnly}
        hint="One site address per line. Leave it empty to let any site embed this form. The form’s own page always works."
        error={errors.embedOrigins ?? sitesError}
        onChange={v => {
          setSites(v);
          if (sitesError) setSitesError(null);
        }}
        onBlur={saveSites}
      />
    </SettingsCard>
  );
}

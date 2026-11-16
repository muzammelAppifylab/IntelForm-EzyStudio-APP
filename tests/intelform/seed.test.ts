import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {formDefinition, type FormDefinition} from '../../src/lib/intelform/form/definition';
import {emailDedupeKey, validateSubmission} from '../../src/lib/intelform/form/logic';
import {formSettings} from '../../src/lib/intelform/form/settings';
import {formTheme} from '../../src/lib/intelform/form/theme';
import {buildSearchText} from '../../src/server/intelform/respondent/answers';

/**
 * prisma/seed.sql is static SQL; these checks keep it loadable by the platform (database.md
 * "Seed and tools") and keep its rows what the app itself would have written.
 */
const SQL = readFileSync(fileURLToPath(new URL('../../prisma/seed.sql', import.meta.url)), 'utf8');

/** The SQL with `--` comments removed (comments may mention words the checks look for). */
const CODE = SQL.split('\n')
  .filter(l => !l.trimStart().startsWith('--'))
  .join('\n');

/** Split one `(a, b, 'c, d', f(x, y))` tuple into its top-level values. */
function splitTuple(row: string): string[] {
  const s = row.trim().replace(/,$/, '');
  if (!s.startsWith('(') || !s.endsWith(')')) throw new Error(`not a tuple: ${s.slice(0, 60)}`);
  const body = s.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") cur += body[++i];
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The top-level `(…)` tuples of a VALUES list (string literals may hold newlines and commas). */
function topLevelTuples(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (ch === "'") {
        if (body[i + 1] === "'") i++;
        else inStr = false;
      }
    } else if (ch === "'") inStr = true;
    else if (ch === '(') {
      if (depth++ === 0) start = i;
    } else if (ch === ')' && --depth === 0) out.push(body.slice(start, i + 1));
  }
  return out;
}

/** A SQL string literal ('…' or '…'::jsonb) as its text. */
function str(v: string): string {
  const m = /^'((?:[^']|'')*)'(?:::jsonb)?$/.exec(v);
  if (!m) throw new Error(`not a string literal: ${v.slice(0, 60)}`);
  return m[1]!.replace(/''/g, "'");
}
const json = (v: string): unknown => JSON.parse(str(v));

/** The rows of `INSERT INTO "<table>" (cols) VALUES … ON CONFLICT`, keyed by column name. */
function rows(table: string): Record<string, string>[] {
  const re = new RegExp(`INSERT INTO "${table}" \\(([^)]*)\\) VALUES\\n([\\s\\S]*?)\\nON CONFLICT DO NOTHING;`, 'g');
  const out: Record<string, string>[] = [];
  for (const m of SQL.matchAll(re)) {
    const cols = m[1]!.split(',').map(c => c.trim().replace(/"/g, ''));
    for (const tuple of topLevelTuples(m[2]!)) {
      const vals = splitTuple(tuple);
      expect(vals).toHaveLength(cols.length);
      out.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]!])));
    }
  }
  return out;
}

const forms = rows('forms');
const versions = rows('form_versions');
const responses = rows('responses');

describe('prisma/seed.sql: platform rules', () => {
  it('is one transaction that starts with the real-data guard', () => {
    const lines = CODE.split('\n').filter(l => l.trim());
    expect(lines[0]).toBe('BEGIN;');
    expect(lines[1]).toBe('DO $$');
    expect(lines.at(-1)).toBe('COMMIT;');
    expect(CODE).toMatch(/DO \$\$[\s\S]*?RAISE EXCEPTION[\s\S]*?END \$\$;/);
  });

  it('has nothing the platform refuses in a seed', () => {
    expect(CODE).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COPY|EXECUTE)\b/i);
    expect(CODE).not.toMatch(/\bEXTENSION\b|\bROLE\b/i);
    expect(CODE).not.toMatch(/INSERT INTO "(users|roles|user_roles|permissions|role_permissions|refresh_tokens)"/);
    expect(CODE).not.toMatch(/password_hash|passwordHash":"/);
  });

  it('only uses @example.com addresses', () => {
    const emails = SQL.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(emails.length).toBeGreaterThan(10);
    for (const e of emails) expect(e).toMatch(/@example\.com$/);
  });

  it('makes every INSERT safe to run twice', () => {
    const inserts = CODE.match(/INSERT INTO[\s\S]*?;/g) ?? [];
    expect(inserts.length).toBeGreaterThan(4);
    for (const s of inserts) expect(s).toMatch(/ON CONFLICT DO NOTHING;$/);
  });

  it('never writes the trigger-filled contact columns', () => {
    expect(CODE).not.toMatch(/"contact_(email|name|phone|key)"/);
  });

  it('lets the guard pass for every sample form, and only those', () => {
    const guard = /DO \$\$([\s\S]*?)END \$\$;/.exec(CODE)![1]!;
    const listed = new Set(guard.match(/'[0-9a-f-]{36}'/g)!.map(s => s.slice(1, -1)));
    for (const f of forms) expect(listed.has(str(f.id!))).toBe(true);
  });
});

describe('prisma/seed.sql: sample data', () => {
  it('has four live forms, a closed one and a draft, with unique slugs', () => {
    const statuses = forms.map(f => str(f.status!)).sort();
    expect(statuses).toEqual(['closed', 'draft', 'live', 'live', 'live', 'live']);
    const slugs = forms.map(f => str(f.slug!));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(slugs).toEqual(expect.arrayContaining(['contact-us', 'how-are-we-doing']));
  });

  it('stores drafts, settings and themes exactly as the app parses them', () => {
    for (const f of forms) {
      const draft = json(f.draft!);
      expect(formDefinition.parse(draft)).toEqual(draft);
      const settings = json(f.settings!) as Record<string, unknown>;
      expect(formSettings.parse(settings)).toEqual(settings);
      expect(settings.notifyOnResponse).toBe(false);
      expect(settings.webhook).toMatchObject({enabled: false});
      expect(settings.closed).toBe(str(f.status!) === 'closed');
      const theme = json(f.theme!);
      expect(formTheme.parse(theme)).toEqual(theme);
    }
  });

  it('gives every published form a version and the draft none', () => {
    for (const f of forms) {
      const own = versions.filter(v => str(v.form_id!) === str(f.id!));
      if (str(f.status!) === 'draft') expect(own).toHaveLength(0);
      else expect(own.length).toBeGreaterThan(0);
      own.forEach((v, i) => expect(Number(v.version)).toBe(i + 1));
      for (const v of own) {
        const def = json(v.definition!);
        expect(formDefinition.parse(def)).toEqual(def);
      }
      if (own.length) {
        const latest = own.at(-1)!;
        expect(SQL).toContain(`SET "published_version_id" = ${latest.id} WHERE "id" = ${f.id}`);
        expect(json(latest.definition!)).toEqual(json(f.draft!));
      }
    }
  });

  it('has about 40 responses spread over the last weeks', () => {
    expect(responses.length).toBeGreaterThanOrEqual(40);
    const ids = responses.map(r => str(r.id!));
    expect(new Set(ids).size).toBe(ids.length);
    const days = new Set(responses.map(r => Math.floor(Number(/interval '(\d+) minutes'/.exec(r.submitted_at!)?.[1] ?? 0) / 1440)));
    expect(days.size).toBeGreaterThan(20);
  });

  it('stores answers, search text and email keys exactly as the submit route would', () => {
    const versionDef = new Map<string, {def: FormDefinition; version: number}>(
      versions.map(v => [str(v.id!), {def: formDefinition.parse(json(v.definition!)), version: Number(v.version)}]),
    );
    const formSettingsById = new Map(forms.map(f => [str(f.id!), formSettings.parse(json(f.settings!))]));
    for (const r of responses) {
      const v = versionDef.get(str(r.form_version_id!));
      expect(v, `version of ${r.id}`).toBeDefined();
      expect(versions.find(x => str(x.id!) === str(r.form_version_id!))!.form_id).toBe(r.form_id);
      const answers = json(r.answers!) as Record<string, unknown>;
      // Consent "at" is filled from submitted_at by the UPDATE that follows the insert.
      const input = structuredClone(answers);
      for (const f of v!.def.fields) if (f.type === 'consent' && input[f.id]) (input[f.id] as Record<string, unknown>).at = '2026-01-01T00:00:00.000Z';
      const res = validateSubmission(v!.def, input, {context: {now: new Date('2026-01-01T00:00:00Z'), formVersion: v!.version}, hidden: 'reject'});
      expect(res.ok, `${r.id}: ${JSON.stringify(!res.ok && res.errors)}`).toBe(true);
      if (res.ok) expect(res.answers).toEqual(input);
      expect(str(r.search_text!)).toBe(buildSearchText(v!.def.fields, answers));
      const s = formSettingsById.get(str(r.form_id!))!;
      const key = s.onePerEmail && s.onePerEmailFieldId ? emailDedupeKey(String(answers[s.onePerEmailFieldId])) : null;
      expect(r.email_key === 'NULL' ? null : str(r.email_key!)).toBe(key);
      expect(str(r.device!)).toMatch(/^(desktop|mobile|tablet)$/);
      expect(str(r.country!)).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('has repeat respondents, so the contacts page has people with several responses', () => {
    const emails = responses.flatMap(r => Object.values(json(r.answers!) as Record<string, unknown>).filter(v => typeof v === 'string' && v.endsWith('@example.com')));
    const counts = new Map<unknown, number>();
    for (const e of emails) counts.set(e, (counts.get(e) ?? 0) + 1);
    expect([...counts.values()].filter(n => n > 1).length).toBeGreaterThanOrEqual(5);
  });

  it('fills the funnel counts and the forms list counters', () => {
    expect(CODE).toMatch(/INSERT INTO "form_event_counts"[\s\S]*WHERE NOT EXISTS[\s\S]*ON CONFLICT DO NOTHING;/);
    expect(CODE).toMatch(/UPDATE "forms" f SET "response_count" = s\.n, "last_response_at" = s\.last/);
  });

  it('has a saved theme that the theme editor can read', () => {
    const themes = rows('themes');
    expect(themes).toHaveLength(1);
    const t = json(themes[0]!.settings!);
    expect(formTheme.parse(t)).toEqual(t);
  });
});

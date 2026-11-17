/**
 * LOCAL DEVELOPMENT ONLY (F-032): which database each local tool really talks to.
 *
 * On your own computer two kinds of tools read `DATABASE_URL`, from different places:
 *
 *   - the Prisma CLI (`prisma migrate …`, `db:seed`, `studio`; prisma.config.ts) and
 *     `npm run dev-admin`: the SHELL's `DATABASE_URL` when one is set, else `.env`;
 *   - the dev server (`npm run dev`, `astro dev`): the Worker runs in workerd, whose variables
 *     come from `.dev.vars` when that file exists, else `.env` then `.env.local`. The shell is
 *     ignored (unless `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`).
 *
 * So `DATABASE_URL=…/other npx astro dev` migrates nothing and still writes to (and deletes from)
 * the `.env` database, while `DATABASE_URL=…/other npx prisma migrate deploy` changes `other`.
 * Both tools call `checkDevDatabase()` at start: it names the database each one uses (name, host
 * and port only, never the user or password) and warns when they differ.
 *
 * Imported by astro.config.mjs and prisma.config.ts only (Node): never by Worker code.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseEnv} from 'node:util';

/** A database URL as a person can read it, with no credentials: `site on localhost:5432`. */
export function databaseLabel(url: string | undefined | null): string {
  const value = (url ?? '').trim();
  if (!value) return '(none: DATABASE_URL is empty)';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '(DATABASE_URL is not a URL)';
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || '(default database)';
  const host = parsed.hostname || '(no host)';
  return `"${name}" on ${host}${parsed.port ? `:${parsed.port}` : ''}`;
}

/** The parts that pick a database: same protocol, host, port, name and user = the same database. */
function databaseIdentity(url: string): string {
  try {
    const u = new URL(url.trim());
    return [u.protocol, u.hostname.toLowerCase(), u.port || '5432', u.pathname.replace(/^\/+/, ''), u.username].join('|');
  } catch {
    return url.trim();
  }
}

/** Whether two `DATABASE_URL`s reach the same database (ignores password and query options). */
export function sameDatabase(a: string, b: string): boolean {
  return databaseIdentity(a) === databaseIdentity(b);
}

export interface EnvFiles {
  /** Contents of `.dev.vars`, `.env`, `.env.local`; `undefined` when the file does not exist. */
  devVars?: string;
  env?: string;
  envLocal?: string;
}

/** Reads the env files the dev server and Prisma CLI look at, in `dir`. */
export function readEnvFiles(dir: string): EnvFiles {
  const read = (name: string) => {
    const path = join(dir, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };
  return {devVars: read('.dev.vars'), env: read('.env'), envLocal: read('.env.local')};
}

function fileValue(text: string | undefined, key: string): string | undefined {
  if (text === undefined) return undefined;
  return parseEnv(text)[key];
}

export interface DevDatabaseInputs {
  files: EnvFiles;
  /** The shell's environment (`process.env`) BEFORE any `.env` file was loaded into it. */
  shell: Record<string, string | undefined>;
}

export interface DevDatabaseTargets {
  /** What the dev server's Worker gets, and from where. */
  devServer: {url: string; source: string};
  /** What the Prisma CLI and dev-admin use, and from where. */
  cli: {url: string; source: string};
  /** Set when the shell's `DATABASE_URL` reaches a different database than the dev server's. */
  mismatch: boolean;
}

/** Works out which database the dev server and the Prisma CLI use (see the file comment). */
export function devDatabaseTargets({files, shell}: DevDatabaseInputs): DevDatabaseTargets {
  const shellUrl = shell.DATABASE_URL;
  const includeShell = /^(true|1)$/i.test(shell.CLOUDFLARE_INCLUDE_PROCESS_ENV ?? '');

  let devServer: {url: string; source: string};
  if (files.devVars !== undefined) {
    devServer = {url: fileValue(files.devVars, 'DATABASE_URL') ?? '', source: '.dev.vars'};
  } else {
    const local = fileValue(files.envLocal, 'DATABASE_URL');
    const env = fileValue(files.env, 'DATABASE_URL');
    if (includeShell && shellUrl !== undefined) devServer = {url: shellUrl, source: 'the shell (CLOUDFLARE_INCLUDE_PROCESS_ENV)'};
    else if (local !== undefined) devServer = {url: local, source: '.env.local'};
    else devServer = {url: env ?? '', source: '.env'};
  }

  const cli =
    shellUrl !== undefined
      ? {url: shellUrl, source: 'the shell'}
      : {url: fileValue(files.env, 'DATABASE_URL') ?? '', source: '.env'};

  const mismatch = shellUrl !== undefined && !sameDatabase(shellUrl, devServer.url);
  return {devServer, cli, mismatch};
}

/**
 * The lines a tool prints at start. `tool` is who is speaking: the dev server names its own
 * database; the Prisma CLI names its own. Either one warns, loudly, on a mismatch.
 */
export function devDatabaseReport(targets: DevDatabaseTargets, tool: 'dev-server' | 'prisma'): {level: 'info' | 'warn'; lines: string[]} {
  const server = `${databaseLabel(targets.devServer.url)} (from ${targets.devServer.source})`;
  const cli = `${databaseLabel(targets.cli.url)} (from ${targets.cli.source})`;
  if (!targets.mismatch) {
    const own = tool === 'dev-server' ? server : cli;
    return {level: 'info', lines: [`${tool === 'dev-server' ? 'Dev server' : 'Prisma'} database: ${own}`]};
  }
  return {
    level: 'warn',
    lines: [
      '──────── DATABASE MISMATCH: the shell and the dev server use different databases ────────',
      `  dev server (npm run dev, astro dev):         ${server}`,
      `  Prisma CLI, db:seed, dev-admin (this shell): ${cli}`,
      '  The dev server never reads DATABASE_URL from the shell: it reads .dev.vars or .env.',
      '  Migrations and seeds from this shell go to one database while the running app reads,',
      '  writes and deletes in the other. To use another database, put it in .env (then restart',
      '  npm run dev), or unset DATABASE_URL in this shell.',
      '─────────────────────────────────────────────────────────────────────────────────────────',
    ],
  };
}

/**
 * Reads the files in `dir` and reports for `tool`. `null` (say nothing) off a developer's own
 * computer: in the editor Preview (`SITE_PREVIEW`) and in a Build, where no env file exists and
 * the platform hands each tool its own variables.
 */
export function checkDevDatabase(
  dir: string,
  shell: Record<string, string | undefined>,
  tool: 'dev-server' | 'prisma',
): {level: 'info' | 'warn'; lines: string[]} | null {
  if (shell.SITE_PREVIEW) return null;
  const files = readEnvFiles(dir);
  if (files.devVars === undefined && files.env === undefined && files.envLocal === undefined) return null;
  return devDatabaseReport(devDatabaseTargets({files, shell}), tool);
}

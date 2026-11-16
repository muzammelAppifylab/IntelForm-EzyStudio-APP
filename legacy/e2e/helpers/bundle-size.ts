/**
 * Bundle budget for the respondent page (docs/research/06-security-quality.md B7): fails if the
 * `/f/*` entry exceeds BUDGET_KB gzip. Run after `npm run build`:
 *
 *   npx tsx e2e/helpers/bundle-size.ts            # BUDGET_KB=120 by default
 *   BUDGET_KB=110 npx tsx e2e/helpers/bundle-size.ts
 *
 * What counts: everything the browser must fetch before the form can render. That is the entry
 * script of dist/form.html (the respondent entry) plus every chunk it imports statically, plus
 * its stylesheets. Dynamic imports (lazy field types, fonts) are listed but not counted.
 * Without dist/form.html (no second Vite entry yet) it falls back to dist/index.html plus the
 * PublicFormPage route chunk, and says so.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = resolve(process.argv[2] ?? 'dist')
const BUDGET_KB = Number(process.env.BUDGET_KB ?? 120)

const gz = (file: string) => gzipSync(readFileSync(file), { level: 9 }).length
const kb = (bytes: number) => (bytes / 1024).toFixed(1)

function htmlAssets(html: string): { scripts: string[]; styles: string[] } {
  const scripts = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g), ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1])
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1])
  return { scripts, styles }
}

const local = (url: string) => join(DIST, url.replace(/^\//, ''))

/** Static `import … from "./x.js"` / `import "./x.js"` / `export … from` closure of a chunk. */
function closure(entries: string[]): { statics: Set<string>; dynamics: Set<string> } {
  const statics = new Set<string>()
  const dynamics = new Set<string>()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()!
    if (statics.has(file) || !existsSync(file)) continue
    statics.add(file)
    const src = readFileSync(file, 'utf8')
    const dir = file.slice(0, file.lastIndexOf('/'))
    for (const m of src.matchAll(/(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["'`](\.{1,2}\/[^"'`]+\.js)["'`]/g)) queue.push(resolve(dir, m[1]))
    for (const m of src.matchAll(/import\(\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]\s*\)/g)) dynamics.add(resolve(dir, m[1]))
  }
  for (const s of statics) dynamics.delete(s)
  return { statics, dynamics }
}

function main(): number {
  const formHtml = join(DIST, 'form.html')
  const separate = existsSync(formHtml)
  const htmlFile = separate ? formHtml : join(DIST, 'index.html')
  if (!existsSync(htmlFile)) {
    console.error(`No ${htmlFile}. Run npm run build first.`)
    return 2
  }
  const { scripts, styles } = htmlAssets(readFileSync(htmlFile, 'utf8'))
  const entries = scripts.map(local)
  if (!separate) {
    // SPA fallback: the /f/:slug route chunk is lazy-loaded right after the entry.
    const { dynamics } = closure(entries)
    const route = [...dynamics].find((f) => /\/PublicFormPage-[\w-]+\.js$/.test(f))
    if (route) entries.push(route)
  }
  const { statics, dynamics } = closure(entries)
  const js = [...statics].map((f) => ({ f, gz: gz(f) })).sort((a, b) => b.gz - a.gz)
  const css = styles.map(local).filter(existsSync).map((f) => ({ f, gz: gz(f) }))
  const jsTotal = js.reduce((n, x) => n + x.gz, 0)
  const cssTotal = css.reduce((n, x) => n + x.gz, 0)
  const lazyTotal = [...dynamics].filter(existsSync).reduce((n, f) => n + gz(f), 0)
  const total = jsTotal + cssTotal

  const rel = (f: string) => f.slice(DIST.length + 1)
  console.log(separate ? 'Respondent entry: dist/form.html' : 'No dist/form.html: measuring dist/index.html + the PublicFormPage route chunk (SPA fallback)')
  for (const x of js) console.log(`  js   ${kb(x.gz).padStart(7)} KB  ${rel(x.f)}`)
  for (const x of css) console.log(`  css  ${kb(x.gz).padStart(7)} KB  ${rel(x.f)}`)
  console.log(`JS ${kb(jsTotal)} KB + CSS ${kb(cssTotal)} KB = ${kb(total)} KB gzip (budget ${BUDGET_KB} KB). Lazy chunks, not counted: ${kb(lazyTotal)} KB in ${dynamics.size} files.`)
  if (total > BUDGET_KB * 1024) {
    console.error(`Over budget by ${kb(total - BUDGET_KB * 1024)} KB.`)
    return 1
  }
  return 0
}

process.exit(main())

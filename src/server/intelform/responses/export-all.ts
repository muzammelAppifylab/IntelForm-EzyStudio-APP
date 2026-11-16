import type {PrismaClient} from '../../../platform/db';
import {loadCatalog} from './catalog';
import {exportFormCsv} from './csv';
import {entryName, zipChunks, type ZipEntry} from './zip';

/**
 * "Export all responses" (Settings → Data): a ZIP with one CSV per form, streamed, each CSV the
 * same as that form's responses export. Forms are read in keyset batches, each form's
 * responses in keyset batches (csv.ts): memory stays flat however much there is.
 * (IntelForm built this with `archiver` on Node; zip.ts is a Worker-safe STORE-only writer.)
 */

const FORM_BATCH = 50;

async function* formEntries(db: PrismaClient, aborted: () => boolean): AsyncGenerator<ZipEntry> {
  const used = new Set<string>();
  let after: {createdAt: Date; id: string} | null = null;
  let any = false;
  for (;;) {
    const forms: {id: string; slug: string; createdAt: Date}[] = await db.form.findMany({
      where: after
        ? {
            OR: [{createdAt: {gt: after.createdAt}}, {createdAt: after.createdAt, id: {gt: after.id}}],
          }
        : {},
      orderBy: [{createdAt: 'asc'}, {id: 'asc'}],
      take: FORM_BATCH,
      select: {id: true, slug: true, createdAt: true},
    });
    for (const form of forms) {
      if (aborted()) return;
      // Loaded when its turn comes (the form may have been deleted since the batch was read).
      const cat = await loadCatalog(db, form.id);
      if (!cat) continue;
      any = true;
      yield {
        name: entryName(form, used),
        chunks: exportFormCsv(db, cat, {aborted}),
      };
    }
    if (forms.length < FORM_BATCH) break;
    const last = forms[forms.length - 1];
    after = {createdAt: last.createdAt, id: last.id};
  }
  if (!any) yield {name: 'README.txt', chunks: once('No forms yet.\r\n')};
}

async function* once(text: string): AsyncGenerator<string> {
  yield text;
}

/** The ZIP's bytes. */
export function exportAllResponsesZip(db: PrismaClient, aborted: () => boolean = () => false): AsyncGenerator<Uint8Array> {
  return zipChunks(formEntries(db, aborted));
}

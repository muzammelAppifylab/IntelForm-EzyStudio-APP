import type {PrismaClient} from '../../../platform/db';
import {summaryZone} from './math';

/**
 * The app's time zone was saved: marks for the Summary every form whose rollups are in another
 * zone (each starts a new generation in the next runs). One statement; nothing when it didn't change.
 */
export async function markFormsForZone(db: Pick<PrismaClient, '$executeRaw'>, timezone: string): Promise<number> {
  const tz = summaryZone(timezone);
  return db.$executeRaw`
    INSERT INTO intelform_dirty_forms (kind, bucket, form_id)
    SELECT 's', date_trunc('minute', now() - interval '1 hour'), s.form_id FROM form_summary_state s
    WHERE s.tz <> ${tz}
    ON CONFLICT DO NOTHING
  `;
}

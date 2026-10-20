import postgres, { type TransactionSql } from 'postgres'
import { env } from '../env'

/**
 * One shared connection pool. Always use the tagged template (sql`... ${value}`): values are
 * sent as parameters, never spliced into SQL text.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  onnotice: () => {},
  transform: { undefined: null },
  // JIT misfires on jsonb_each / LATERAL summary queries (+0.3–0.6 s measured): keep it off.
  connection: { jit: 'off' },
})

export type Sql = typeof sql
/** The pool or an open transaction: helpers that accept either can join the caller's transaction. */
export type Queryable = Sql | TransactionSql

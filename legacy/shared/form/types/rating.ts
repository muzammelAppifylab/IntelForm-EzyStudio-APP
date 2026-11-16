import * as z from 'zod/mini'
import { NUMBER_OPS, base, defineType, evaluateNumber, single, toNumber } from './common'

function intOrUndefined(v: unknown): number | undefined {
  const n = toNumber(v)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}

const fmt = (v: unknown) => (intOrUndefined(v) === undefined ? '' : String(intOrUndefined(v)))

// ------------------------------------------------------------------ Rating: integer 1..scale

const def = z._default
const label = (value: string) => def(z.string().check(z.maxLength(60)), value)

/** An integer in [min, max]; every failure reports `invalidRating`. */
const score = (min: number, max: number) =>
  z.number({ error: 'invalidRating' }).check(z.int('invalidRating'), z.gte(min, 'invalidRating'), z.lte(max, 'invalidRating'))

const ratingProps = z.object({
  style: def(z.enum(['stars', 'numbers', 'emoji']), 'stars'),
  scale: def(z.number().check(z.int(), z.gte(3), z.lte(10)), 5),
  leftLabel: label(''),
  rightLabel: label(''),
})

export const rating = defineType({
  ...base('rating'),
  props: ratingProps,
  defaultProps: () => ratingProps.parse({}),
  answer: (field) => score(1, field.props.scale),
  isEmpty: (v) => intOrUndefined(v) === undefined,
  operators: NUMBER_OPS,
  evaluate: (op, a, v) => evaluateNumber(op, intOrUndefined(a), v),
  pipeParts: () => [],
  pipe: fmt,
  ...single(fmt),
  migrateProps: (from, old) => {
    if (from === 'rating') return z.partial(ratingProps).safeParse(old).data ?? {}
    if (from === 'nps') {
      const out: { leftLabel?: string; rightLabel?: string } = {}
      if (typeof old.lowLabel === 'string') out.leftLabel = old.lowLabel
      if (typeof old.highLabel === 'string') out.rightLabel = old.highLabel
      return out
    }
    return {}
  },
})

// ------------------------------------------------------------------ NPS: integer 0..10

const npsProps = z.object({
  lowLabel: label('Not likely'),
  highLabel: label('Extremely likely'),
})

export const nps = defineType({
  ...base('nps'),
  props: npsProps,
  defaultProps: () => npsProps.parse({}),
  answer: () => score(0, 10),
  isEmpty: (v) => intOrUndefined(v) === undefined,
  operators: NUMBER_OPS,
  evaluate: (op, a, v) => evaluateNumber(op, intOrUndefined(a), v),
  pipeParts: () => [],
  pipe: fmt,
  ...single(fmt),
  migrateProps: (from, old) => {
    if (from === 'nps') return z.partial(npsProps).safeParse(old).data ?? {}
    if (from === 'rating') {
      const out: { lowLabel?: string; highLabel?: string } = {}
      if (typeof old.leftLabel === 'string' && old.leftLabel) out.lowLabel = old.leftLabel
      if (typeof old.rightLabel === 'string' && old.rightLabel) out.highLabel = old.rightLabel
      return out
    }
    return {}
  },
})

/** NPS bucket for summaries: 0–6 detractor, 7–8 passive, 9–10 promoter. */
export function npsCategory(score: number): 'detractor' | 'passive' | 'promoter' {
  return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor'
}

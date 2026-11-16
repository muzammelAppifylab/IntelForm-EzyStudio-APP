export interface NpsCounts {
  detractors: number
  passives: number
  promoters: number
}

/** Which NPS group a 0–10 answer falls in. */
export function npsGroup(score: number): keyof NpsCounts {
  return score <= 6 ? 'detractors' : score <= 8 ? 'passives' : 'promoters'
}

/** NPS = % promoters − % detractors, rounded; null when there are no answers. */
export function npsScore({ detractors, passives, promoters }: NpsCounts) {
  const total = detractors + passives + promoters
  if (total === 0) return null
  return Math.round(((promoters - detractors) / total) * 100)
}

/**
 * Who has a form open in the builder (PRD: "the second editor sees a banner that someone else
 * is editing"). No websockets: each builder tab POSTs every 20 s while visible and DELETEs on
 * pagehide; entries older than 45 s are dropped.
 *
 * In memory, so it only works with a single server instance (the same caveat as the
 * in-process job runner). With several instances, move this to a small Postgres table
 * (form_id, user_id, tab_id, seen_at) and the same 45 s window.
 */

export const PRESENCE_TTL_MS = 45_000

interface Entry {
  userId: string
  name: string
  seenAt: number
}

/** formId → tabId → entry */
const forms = new Map<string, Map<string, Entry>>()

function sweep(formId: string, now: number): Map<string, Entry> | undefined {
  const tabs = forms.get(formId)
  if (!tabs) return undefined
  for (const [tab, e] of tabs) if (now - e.seenAt > PRESENCE_TTL_MS) tabs.delete(tab)
  if (tabs.size === 0) forms.delete(formId)
  return forms.get(formId)
}

export function touchPresence(formId: string, tabId: string, user: { id: string; name: string }, now = Date.now()) {
  sweep(formId, now)
  let tabs = forms.get(formId)
  if (!tabs) forms.set(formId, (tabs = new Map()))
  tabs.set(tabId, { userId: user.id, name: user.name, seenAt: now })
}

export function leavePresence(formId: string, tabId: string, userId: string) {
  const tabs = forms.get(formId)
  if (tabs?.get(tabId)?.userId === userId) tabs.delete(tabId)
  if (tabs && tabs.size === 0) forms.delete(formId)
}

/** Everyone on the form except this tab, newest first, one entry per person (and per own extra tab). */
export function othersOn(formId: string, tabId: string, userId: string, now = Date.now()) {
  const tabs = sweep(formId, now)
  if (!tabs) return []
  const seen = new Set<string>()
  return [...tabs.entries()]
    .filter(([tab]) => tab !== tabId)
    .sort((a, b) => b[1].seenAt - a[1].seenAt)
    .filter(([, e]) => (seen.has(e.userId) ? false : (seen.add(e.userId), true)))
    .map(([, e]) => ({ userId: e.userId, name: e.name, self: e.userId === userId }))
}

/** Test helper. */
export function resetPresence() {
  forms.clear()
}

// Keep the map from growing with abandoned forms.
setInterval(() => {
  const now = Date.now()
  for (const id of [...forms.keys()]) sweep(id, now)
}, 60_000).unref?.()

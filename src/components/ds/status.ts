export const STATUSES = ['live', 'draft', 'closed', 'unpublished', 'new'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = {
  live: 'Live',
  draft: 'Draft',
  closed: 'Closed',
  unpublished: 'Unpublished changes',
  new: 'New',
}

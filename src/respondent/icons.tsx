import type {ReactElement} from 'react';

/**
 * The few icons the public form draws, as inline SVG (Lucide shapes, 24px grid, stroke 2).
 * The respondent bundle stays small: no icon library, no dashboard kit. Every icon is
 * decorative (`aria-hidden`); the control next to it carries the words.
 */
const PATHS = {
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
  check: ['M20 6 9 17l-5-5'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-up': ['m18 15-6-6-6 6'],
  clock: ['M12 6v6l4 2', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2'],
  alert: ['M12 8v4', 'M12 16h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
} as const;

export type RespondentIconName = keyof typeof PATHS;

export function RIcon({name, className}: {name: RespondentIconName; className?: string}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className ? `rf-icon ${className}` : 'rf-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

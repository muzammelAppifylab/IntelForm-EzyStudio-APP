import type {ReactElement} from 'react';

/**
 * Icons the field renderers draw on the public form that the respondent's own set
 * (src/respondent/icons.tsx) does not have. Inline SVG (Lucide shapes, 24px grid, stroke 2), so
 * the public bundle needs no icon library. Always decorative: the control carries the words.
 */
const FACE = 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0';
const EYES = ['M9 9h.01', 'M15 9h.01'];

const PATHS = {
  check: ['M20 6 9 17l-5-5'],
  'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  image: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2',
    'M11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
  ],
  star: [
    'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
  ],
  frown: [FACE, 'M16 16s-1.5-2-4-2-4 2-4 2', ...EYES],
  annoyed: [FACE, 'M8 15h8', 'M8 9h2', 'M14 9h2'],
  meh: [FACE, 'M8 15h8', ...EYES],
  smile: [FACE, 'M8 14s1.5 2 4 2 4-2 4-2', ...EYES],
  laugh: [FACE, 'M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z', ...EYES],
  calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2', 'M3 10h18'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  keyboard: [
    'M10 8h.01',
    'M12 12h.01',
    'M14 8h.01',
    'M16 12h.01',
    'M18 8h.01',
    'M6 8h.01',
    'M7 16h10',
    'M8 12h.01',
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  ],
  'pen-line': [
    'M12 20h9',
    'M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z',
  ],
  eraser: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
} as const;

export type FtIconName = keyof typeof PATHS;

export function FtIcon({name, className}: {name: FtIconName; className?: string}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className ? `ft-icon ${className}` : 'ft-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round">
      {PATHS[name].map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

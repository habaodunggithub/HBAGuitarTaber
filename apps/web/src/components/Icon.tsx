/**
 * One stroke icon set (24px grid, 1.75 stroke, round joins), drawn inline so it follows currentColor.
 * Decorative by default (aria-hidden): the control that holds an icon carries the accessible name.
 */
const PATHS = {
  back: ['M19 12H5', 'm12 19-7-7 7-7'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  down: ['m6 9 6 6 6-6'],
  minus: ['M5 12h14'],
  plus: ['M12 5v14', 'M5 12h14'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  sliders: ['M20 7h-9', 'M14 17H5', 'M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  music: ['M9 18V5l12-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  unlock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M7 11V7a5 5 0 0 1 9.9-1'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  video: ['m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5', 'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'],
  history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  tap: ['M12 3v3', 'M18.4 5.6l-2.1 2.1', 'M5.6 5.6l2.1 2.1', 'M12 21a6 6 0 0 0 6-6c0-1.66-1.34-3-3-3H9c-1.66 0-3 1.34-3 3a6 6 0 0 0 6 6Z'],
  staff: ['M3 6h18', 'M3 10h18', 'M3 14h18', 'M3 18h18'],
  home: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  library: ['M21 15V6', 'M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M12 12H3', 'M16 6H3', 'M12 18H3'],
  keyboard: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M6 8h.01', 'M10 8h.01', 'M14 8h.01', 'M18 8h.01', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01', 'M7 16h10'],
  search: ['m21 21-4.34-4.34', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  skipBack: ['M17.97 4.29A2 2 0 0 1 21 6v12a2 2 0 0 1-3.03 1.71l-10-6a2 2 0 0 1 0-3.42z', 'M3 20V4'],
  skipForward: ['M21 4v16', 'M6.03 4.29A2 2 0 0 0 3 6v12a2 2 0 0 0 3.03 1.71l10-6a2 2 0 0 0 0-3.42z'],
  arrowUpRight: ['M7 7h10v10', 'M7 17 17 7'],
  disc: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon-svg ${className}` : 'icon-svg'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The brand wordmark: pixel type with a record for the "a". */
export function Wordmark() {
  return (
    <span className="wordmark" translate="no">
      TAB<span className="wm-disc" aria-hidden="true" />ER
    </span>
  );
}

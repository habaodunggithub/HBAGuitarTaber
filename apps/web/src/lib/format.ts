export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
export function fmtBytes(n: number): string {
  if (n < 1024) return `${num.format(n)}\u00a0B`;
  if (n < 1024 * 1024) return `${num.format(Math.round(n / 1024))}\u00a0KB`;
  return `${num.format(n / 1024 / 1024)}\u00a0MB`;
}

export const STAGE_LABEL: Record<string, string> = {
  ingest: 'Reading audio',
  separation: 'Removing backing track',
  video: 'Reading the fretting hand',
  beats: 'Finding the beat',
  f0: 'Tracking pitch',
  segment: 'Finding notes and techniques',
  quality: 'Checking quality',
  retry: 'Retrying',
  done: 'Done',
};

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
/** Server timestamps are UTC ISO strings ending in Z. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTime.format(d);
}

const PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** "A minor" / "Eb major" from the analysis key report. */
export function keyLabel(k: { tonic: number; mode: 'major' | 'minor' }): string {
  return `${PC[((k.tonic % 12) + 12) % 12]} ${k.mode === 'major' ? 'major' : 'minor'}`;
}

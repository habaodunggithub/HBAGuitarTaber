import { getT } from '../i18n';

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function fmtBytes(n: number): string {
  const num = new Intl.NumberFormat(getT().language.locale, { maximumFractionDigits: 1 });
  if (n < 1024) return `${num.format(n)}\u00a0B`;
  if (n < 1024 * 1024) return `${num.format(Math.round(n / 1024))}\u00a0KB`;
  return `${num.format(n / 1024 / 1024)}\u00a0MB`;
}

/** Server timestamps are UTC ISO strings ending in Z. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(getT().language.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

const PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** "A minor" / "Eb major" from the analysis key report. */
export function keyLabel(k: { tonic: number; mode: 'major' | 'minor' }): string {
  const tonic = PC[((k.tonic % 12) + 12) % 12]!;
  return k.mode === 'major' ? getT().music.major(tonic) : getT().music.minor(tonic);
}

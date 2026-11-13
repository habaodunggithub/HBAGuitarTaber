// Same convention as taber_ir: string 1 = highest-pitched, string 6 = lowest.
import type { Tuning } from '../api/types';

export type { Tuning };

export const STANDARD = [64, 59, 55, 50, 45, 40];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const TUNING_PRESETS: Record<string, number[]> = {
  'Standard (E A D G B E)': STANDARD,
  'Drop D': [64, 59, 55, 50, 45, 38],
  'Half step down (Eb)': [63, 58, 54, 49, 44, 39],
  'Whole step down (D)': [62, 57, 53, 48, 43, 38],
  'Open G': [62, 59, 55, 50, 43, 38],
  DADGAD: [62, 57, 55, 50, 45, 38],
};

export function openPitch(t: Tuning, string: number): number {
  const p = t.open_pitches?.[string - 1];
  if (p === undefined) throw new RangeError(`string ${string} out of range`);
  return p;
}

export function soundingPitch(t: Tuning, string: number, fret: number): number {
  return openPitch(t, string) + (t.capo ?? 0) + fret;
}

export function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function presetName(t: Tuning): string {
  const key = Object.entries(TUNING_PRESETS).find(
    ([, v]) => v.length === t.open_pitches?.length && v.every((x, i) => x === t.open_pitches?.[i]),
  );
  return key ? key[0] : 'Custom';
}

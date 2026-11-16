// Where the video stage saw the neck at a given time (Analysis.video_track), for the overlay on the video.
import { fretU, quadToImage, type Pt } from './homography';

export interface VideoTrack {
  time_offset_s: number;
  /** frame size the coordinates were measured on (the aspect ratio of the video) */
  size: [number, number];
  fret_a: number;
  fret_b: number;
  /** how the neck tapers (absent on tracks from before: parallel strings) */
  taper?: number;
  /** [t, tracked 0|1, x1, y1, .. x4, y4]: the calibration corners as seen in that frame, normalised */
  samples: number[][];
  /** [t, x, y, finger]: fingertips that counted as evidence at a note onset, normalised */
  tips: number[][];
}

export interface NeckFrame {
  /** corners (fret A, string 6), (A, 1), (B, 1), (B, 6) in `size` pixels */
  quad: Pt[];
  /** false: tracking was lost here and the analysis fell back on the calibration frame */
  tracked: boolean;
  tips: { x: number; y: number; finger: number }[];
}

const MAX_GAP_S = 0.3; // no sample this close: show nothing rather than a stale neck
const TIP_WINDOW_S = 0.06;

/** Index of the last element whose time (row[0]) is <= t, or -1. */
function lastAtOrBefore(rows: number[][], t: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]![0]! <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const corners = (row: number[], w: number, h: number): Pt[] =>
  [0, 1, 2, 3].map((k) => [row[2 + 2 * k]! * w, row[3 + 2 * k]! * h] as Pt);

/** The neck at video time t: interpolated between two tracked samples, else the nearest sample. */
export function neckAt(track: VideoTrack, t: number): NeckFrame | null {
  const s = track.samples;
  const [w, h] = track.size;
  if (!s.length) return null;
  const i = lastAtOrBefore(s, t);
  const a = i >= 0 ? s[i] : undefined;
  const b = s[i + 1];
  let quad: Pt[];
  let tracked: boolean;
  if (a && b && a[1] && b[1] && b[0]! - a[0]! <= MAX_GAP_S) {
    const k = Math.min(Math.max((t - a[0]!) / Math.max(b[0]! - a[0]!, 1e-6), 0), 1);
    const qa = corners(a, w, h);
    const qb = corners(b, w, h);
    quad = qa.map(([x, y], j) => [x + (qb[j]![0] - x) * k, y + (qb[j]![1] - y) * k] as Pt);
    tracked = true;
  } else {
    const near = !a ? b! : !b ? a : t - a[0]! <= b[0]! - t ? a : b;
    if (Math.abs(near[0]! - t) > MAX_GAP_S) return null;
    quad = corners(near, w, h);
    tracked = !!near[1];
  }
  // fingertips of the onset frame closest to t (all tips of one frame share its time)
  const tips: NeckFrame['tips'] = [];
  const j = lastAtOrBefore(track.tips, t);
  const cand = [track.tips[j], track.tips[j + 1]].filter((r): r is number[] => !!r && Math.abs(r[0]! - t) <= TIP_WINDOW_S);
  if (cand.length) {
    const t0 = cand.reduce((m, r) => (Math.abs(r[0]! - t) < Math.abs(m - t) ? r[0]! : m), cand[0]![0]!);
    for (const r of track.tips) if (r[0] === t0) tips.push({ x: r[1]! * w, y: r[2]! * h, finger: r[3]! });
  }
  return { quad, tracked, tips };
}

export interface NeckLines {
  frets: [Pt, Pt][];
  keyFrets: [Pt, Pt][]; // the two calibrated wires
  strings: [Pt, Pt][];
}

/** Fret wires (nut .. a few past fret B) and the six strings, projected into the frame. */
export function neckLines(quad: Pt[], fretA: number, fretB: number, taper = 0): NeckLines {
  const toImg = quadToImage(quad, fretA, fretB, taper);
  const hi = Math.min(fretB + 3, 22);
  const frets: [Pt, Pt][] = [];
  const keyFrets: [Pt, Pt][] = [];
  for (let n = 0; n <= hi; n++) {
    const seg: [Pt, Pt] = [toImg([fretU(n), -0.06]), toImg([fretU(n), 1.06])];
    (n === fretA || n === fretB ? keyFrets : frets).push(seg);
  }
  const strings = Array.from({ length: 6 }, (_, k) => [toImg([0, k / 5]), toImg([fretU(hi), k / 5])] as [Pt, Pt]);
  return { frets, keyFrets, strings };
}

/** SVG path data for a list of segments. */
export const segPath = (segs: [Pt, Pt][]) =>
  segs.map(([a, b]) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`).join('');

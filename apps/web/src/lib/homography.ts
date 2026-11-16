// 4-point homography (same maths as OpenCV's getPerspectiveTransform) for the fretboard calibration preview.
export type Pt = [number, number];
export type Mat3 = number[]; // row-major 3x3

/** H such that H * [x, y, 1] ~ [u, v, 1] for the 4 correspondences src[i] -> dst[i]. */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('need 4 points');
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!;
    const [u, v] = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) throw new Error('degenerate points (three on a line?)');
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

export function apply(H: Mat3, [x, y]: Pt): Pt {
  const w = H[6]! * x + H[7]! * y + H[8]!;
  return [(H[0]! * x + H[1]! * y + H[2]!) / w, (H[3]! * x + H[4]! * y + H[5]!) / w];
}

export const fretU = (n: number) => 1 - 2 ** (-n / 12);

// ── the neck: a plane where the outer strings spread from the nut to the bridge ──
// Mirrors packages/taber_ml/src/taber_ml/video/geometry.py (TAPER, board_to_phys).
export type GuitarBody = 'electric' | 'acoustic' | 'classical' | 'parallel';
export const TAPER: Record<GuitarBody, number> = { parallel: 0, electric: 0.5, acoustic: 0.48, classical: 0.35 };

/** Board (u along the string from the nut, v = 0 on string 6 .. 1 on string 1) -> physical neck plane. */
export const boardToPhys = ([u, v]: Pt, taper: number): Pt => [u, (v - 0.5) * (1 + taper * u)];

/** (u, v) of the calibration clicks: both outer strings on each wire, snaking (A6 A1 B1 B6 C6 C1 ...). */
export function calibrationBoardPoints(frets: number[]): Pt[] {
  return frets.flatMap((f, i) => (i % 2 === 0 ? [[fretU(f), 0], [fretU(f), 1]] : [[fretU(f), 1], [fretU(f), 0]]) as Pt[]);
}

/** Least-squares homography for 4+ correspondences (exact for 4). */
export function fitHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== dst.length || src.length < 4) throw new Error('need 4 or more points');
  if (src.length === 4) return homography(src, dst);
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  const add = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i]! += row[i]! * b;
      for (let j = 0; j < 8; j++) AtA[i]![j]! += row[i]! * row[j]!;
    }
  };
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i]!;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  });
  return [...solve(AtA, Atb), 1];
}

/**
 * Board (u, v) -> image for a calibration: both outer strings clicked on each of `frets` (snaking order).
 * Fitted physical -> image, so the clicks' error is what is minimised (as the worker does).
 */
export function calibrationToImage(points: Pt[], frets: number[], taper: number): (uv: Pt) => Pt {
  const H = fitHomography(calibrationBoardPoints(frets).map((p) => boardToPhys(p, taper)), points);
  return (uv) => apply(H, boardToPhys(uv, taper));
}

/** Board -> image from the 4 fitted corners (A,6) (A,1) (B,1) (B,6) as the worker tracked them. */
export function quadToImage(quad: Pt[], fretA: number, fretB: number, taper = 0): (uv: Pt) => Pt {
  return calibrationToImage(quad, [fretA, fretB], taper);
}

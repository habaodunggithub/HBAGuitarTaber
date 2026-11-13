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

/** Board (u, v) -> image for a calibration: corners (A,6) (A,1) (B,1) (B,6). */
export function boardToImage(points: Pt[], fretA: number, fretB: number): Mat3 {
  const ua = fretU(fretA);
  const ub = fretU(fretB);
  return homography([[ua, 0], [ua, 1], [ub, 1], [ub, 0]], points);
}

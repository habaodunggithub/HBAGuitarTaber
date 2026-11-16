import { describe, expect, it } from 'vitest';
import { apply, boardToPhys, calibrationBoardPoints, calibrationToImage, fretU, homography, TAPER, type Pt } from './homography';

describe('homography', () => {
  it('maps the four correspondences exactly', () => {
    const src: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const dst: Pt[] = [[10, 20], [110, 25], [100, 130], [5, 120]];
    const H = homography(src, dst);
    src.forEach((p, i) => {
      const [x, y] = apply(H, p);
      expect(x).toBeCloseTo(dst[i]![0], 6);
      expect(y).toBeCloseTo(dst[i]![1], 6);
    });
  });
  it('rejects degenerate input', () => {
    expect(() => homography([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toThrow();
  });
  it('places frets between the clicked ones by the 12th-root law', () => {
    const pts: Pt[] = [[900, 300], [900, 200], [300, 200], [300, 300]]; // fret 5 at x=900, fret 12 at x=300, no perspective
    const [x7] = calibrationToImage(pts, [5, 12], 0)([fretU(7), 0.5]);
    const expected = 900 - ((fretU(7) - fretU(5)) / (fretU(12) - fretU(5))) * 600;
    expect(x7).toBeCloseTo(expected, 6);
    expect(fretU(12)).toBeCloseTo(0.5, 12);
  });

  it('clicks snake over the wires: A6 A1 B1 B6 C6 C1', () => {
    expect(calibrationBoardPoints([5, 7, 12]).map(([, v]) => v)).toEqual([0, 1, 1, 0, 0, 1]);
  });

  // a tapered neck in perspective: physical plane -> image
  const camera = homography([[0, -0.5], [0, 0.5], [0.75, 0.6875], [0.75, -0.6875]], [[880, 330], [880, 250], [90, 200], [90, 380]]);
  const truth = (uv: Pt, taper: number) => apply(camera, boardToPhys(uv, taper));

  it('with the right body type, frets far from the clicked ones land right', () => {
    const taper = TAPER.electric;
    const frets = [5, 12];
    const clicks = calibrationBoardPoints(frets).map((p) => truth(p, taper));
    const right = calibrationToImage(clicks, frets, taper);
    const parallel = calibrationToImage(clicks, frets, 0);
    for (const n of [1, 17]) {
      const want = truth([fretU(n), 0], taper);
      expect(Math.hypot(right([fretU(n), 0])[0] - want[0], right([fretU(n), 0])[1] - want[1])).toBeLessThan(1e-6);
      expect(Math.hypot(parallel([fretU(n), 0])[0] - want[0], parallel([fretU(n), 0])[1] - want[1])).toBeGreaterThan(2); // px
    }
  });

  it('fits more than two wires (least squares, exact without noise)', () => {
    const taper = TAPER.classical;
    const frets = [3, 5, 7, 9, 12];
    const toImg = calibrationToImage(calibrationBoardPoints(frets).map((p) => truth(p, taper)), frets, taper);
    const [x, y] = toImg([fretU(15), 0.4]);
    const [wx, wy] = truth([fretU(15), 0.4], taper);
    expect(x).toBeCloseTo(wx, 4);
    expect(y).toBeCloseTo(wy, 4);
  });
});

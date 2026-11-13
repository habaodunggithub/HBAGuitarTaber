import { describe, expect, it } from 'vitest';
import { apply, boardToImage, fretU, homography, type Pt } from './homography';

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
    const H = boardToImage(pts, 5, 12);
    const [x7] = apply(H, [fretU(7), 0.5]);
    const expected = 900 - ((fretU(7) - fretU(5)) / (fretU(12) - fretU(5))) * 600;
    expect(x7).toBeCloseTo(expected, 6);
    expect(fretU(12)).toBeCloseTo(0.5, 12);
  });
});

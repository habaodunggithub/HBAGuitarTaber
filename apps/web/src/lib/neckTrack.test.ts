import { describe, expect, it } from 'vitest';
import { neckAt, neckLines, type VideoTrack } from './neckTrack';

// quad (A,6) (A,1) (B,1) (B,6), normalised, shifted by dx across samples
const row = (t: number, ok: number, dx = 0) => [t, ok, 0.1 + dx, 0.6, 0.1 + dx, 0.4, 0.5 + dx, 0.4, 0.5 + dx, 0.6];
const track = (samples: number[][], tips: number[][] = []): VideoTrack =>
  ({ time_offset_s: 0, size: [1000, 500], fret_a: 3, fret_b: 12, samples, tips });

describe('neckAt', () => {
  it('interpolates between two tracked samples', () => {
    const f = neckAt(track([row(1, 1, 0), row(1.1, 1, 0.01)]), 1.05)!;
    expect(f.tracked).toBe(true);
    expect(f.quad[0]![0]).toBeCloseTo(105); // halfway between 100 and 110 px
    expect(f.quad[0]![1]).toBeCloseTo(300);
  });

  it('shows the fallback (not tracked) as such, without interpolating across it', () => {
    const tr = track([row(1, 1, 0), row(1.1, 0, 0.05)]);
    expect(neckAt(tr, 1.02)!.tracked).toBe(true); // nearest is the tracked one
    const lost = neckAt(tr, 1.08)!;
    expect(lost.tracked).toBe(false);
    expect(lost.quad[0]![0]).toBeCloseTo(150);
  });

  it('shows nothing far from any sample', () => {
    const tr = track([row(1, 1), row(5, 1)]);
    expect(neckAt(tr, 0.2)).toBeNull();
    expect(neckAt(tr, 3)).toBeNull(); // a 4 s gap is not interpolated
    expect(neckAt(tr, 5.2)).not.toBeNull();
    expect(neckAt(track([]), 1)).toBeNull();
  });

  it('shows the fingertips of the onset frame nearest in time', () => {
    const tr = track([row(1, 1), row(1.1, 1)], [[1.02, 0.3, 0.5, 1], [1.02, 0.35, 0.45, 2], [1.07, 0.4, 0.5, 3]]);
    expect(neckAt(tr, 1.03)!.tips).toEqual([{ x: 300, y: 250, finger: 1 }, { x: 350, y: 225, finger: 2 }]);
    expect(neckAt(tr, 1.065)!.tips.map((p) => p.finger)).toEqual([3]);
    expect(neckAt(tr, 1.2)!.tips).toEqual([]);
  });
});

describe('neckLines', () => {
  it('puts the calibrated wires on the quad edges and the strings across it', () => {
    const quad: [number, number][] = [[100, 300], [100, 200], [500, 200], [500, 300]];
    const l = neckLines(quad, 3, 12);
    expect(l.keyFrets).toHaveLength(2);
    expect(l.frets).toHaveLength(14); // 0..15 minus the two key wires
    const [a, b] = l.keyFrets[0]!;
    expect(a[0]).toBeCloseTo(100);
    expect(b[0]).toBeCloseTo(100);
    expect(l.strings).toHaveLength(6);
    expect(l.strings[0]![0][1]).toBeCloseTo(300); // string 6 at v = 0
    expect(l.strings[5]![0][1]).toBeCloseTo(200); // string 1 at v = 1
  });
});

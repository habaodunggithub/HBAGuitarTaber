"""Beat map (time <-> beat position) and the four timing modes (docs §4.2 Stage 7)."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..models import Analysis, AssemblyParams

DEFAULT_BPM = 120.0


@dataclass
class BeatMap:
    """Piecewise-linear map between seconds and beat positions (beat 0 = beats_s[0])."""

    beats_s: np.ndarray

    def __post_init__(self) -> None:
        b = np.asarray(self.beats_s, dtype=float)
        if len(b) < 2 or np.any(np.diff(b) <= 0):
            raise ValueError("BeatMap needs >= 2 strictly increasing beat times")
        self.beats_s = b

    def pos(self, t: float) -> float:
        b = self.beats_s
        if t <= b[0]:
            return float((t - b[0]) / (b[1] - b[0]))
        if t >= b[-1]:
            return float(len(b) - 1 + (t - b[-1]) / (b[-1] - b[-2]))
        return float(np.interp(t, b, np.arange(len(b))))

    def time(self, pos: float) -> float:
        b = self.beats_s
        n = len(b)
        if pos <= 0:
            return float(b[0] + pos * (b[1] - b[0]))
        if pos >= n - 1:
            return float(b[-1] + (pos - (n - 1)) * (b[-1] - b[-2]))
        return float(np.interp(pos, np.arange(n), b))


def parse_time_signature(ts: str | None) -> tuple[int, int]:
    try:
        n, d = (ts or "4/4").split("/")
        num, den = int(n), int(d)
    except Exception:
        return 4, 4
    if num < 1 or den not in (1, 2, 4, 8):  # x/16: bar line no longer a multiple of 12 units
        return 4, 4
    return num, den


def fit_phase(onsets: np.ndarray, period: float) -> tuple[float, float]:
    """Phase coherence of onsets against a grid of ``period`` seconds.

    Returns (coherence 0..1, offset in seconds in [0, period)) where grid points are
    offset + k * period.
    """
    if len(onsets) == 0 or period <= 0:
        return 0.0, 0.0
    ang = 2 * math.pi * onsets / period
    z = np.exp(1j * ang).mean()
    offset = (math.atan2(z.imag, z.real) / (2 * math.pi)) * period
    return float(abs(z)), float(offset % period)


def estimate_free_grid(onsets: list[float]) -> tuple[float, float]:
    """Estimate (beat period s, anchor s) for rubato / unknown-tempo playing.

    Scans beat periods and measures how well onsets fall on a 16th-note grid, with
    a mild preference for 70-140 BPM. The anchor is the grid point nearest the first onset.
    """
    on = np.asarray(sorted(onsets), dtype=float)
    if len(on) < 3:
        return 60.0 / DEFAULT_BPM, float(on[0]) if len(on) else 0.0
    best = (-1.0, 60.0 / DEFAULT_BPM, 0.0)
    for bpm in np.arange(50.0, 200.0, 0.5):
        T = 60.0 / bpm
        coh, off = fit_phase(on, T / 4)
        prior = math.exp(-0.5 * (math.log2(bpm / 100.0) / 0.5) ** 2)
        score = coh * (0.6 + 0.4 * prior)
        if score > best[0]:
            best = (score, T, off)
    _, T, off = best
    step = T / 4
    k = round((on[0] - off) / step)
    return T, float(off + k * step)


def _uniform_beats(period: float, anchor: float, t_end: float, t_start: float) -> np.ndarray:
    k0 = math.floor((t_start - anchor) / period) - 1
    k1 = math.ceil((t_end - anchor) / period) + 2
    ks = np.arange(k0, k1 + 1)
    return anchor + ks * period


def build_beat_map(
    analysis: Analysis, params: AssemblyParams
) -> tuple[BeatMap, float, tuple[int, int], str]:
    """Return (beat map, downbeat position in beats, time signature, timing mode used)."""
    notes = analysis.notes
    onsets = [n.onset_s for n in notes]
    t_start = onsets[0] if onsets else 0.0
    t_end = max((n.offset_s for n in notes), default=1.0)
    ts = parse_time_signature(params.time_signature or analysis.beat_grid.time_signature)
    mode = params.timing
    grid = analysis.beat_grid

    if mode == "auto" and len(grid.beats_s) < 4:
        mode = "free" if not params.tempo_hint_bpm else "grid_from_hint"

    if mode == "user_tapped":
        taps = sorted(params.user_beats_s or [])
        if len(taps) >= 2:
            return BeatMap(np.array(taps)), 0.0, ts, mode
        mode = "grid_from_hint"  # not enough taps -> fall back

    if mode == "grid_from_hint":
        bpm = params.tempo_hint_bpm or grid.tempo_bpm or DEFAULT_BPM
        period = 60.0 / bpm
        if params.user_beats_s:
            anchor = params.user_beats_s[0]
        else:
            coh, off = fit_phase(np.asarray(onsets), period / 4)
            first = grid.downbeats_s[0] if grid.downbeats_s else t_start
            step = period / 4
            anchor = off + round((first - off) / step) * step if coh > 0.2 else first
        beats = _uniform_beats(period, anchor, t_end, min(t_start, anchor))
        return BeatMap(beats), (anchor - beats[0]) / period, ts, mode

    if mode == "free":
        period, anchor = estimate_free_grid(onsets)
        beats = _uniform_beats(period, anchor, t_end, min(t_start, anchor))
        return BeatMap(beats), (anchor - beats[0]) / period, ts, mode

    # auto: detected beat grid
    bm = BeatMap(np.asarray(grid.beats_s))
    if grid.downbeats_s:
        db = bm.pos(grid.downbeats_s[0])
    else:
        db = 0.0
    return bm, db, ts, "auto"

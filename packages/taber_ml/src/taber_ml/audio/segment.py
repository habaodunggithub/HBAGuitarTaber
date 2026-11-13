"""F0-first note segmentation + rule-based technique detection (docs §4.2 Stage 3-4).

Monophonic only. Pipeline: smooth f0 -> split into pitch runs (hysteresis) -> refine onsets
with the spectral-flux envelope -> split repeated notes at strong onsets -> clean up ->
derive techniques from the pitch contour inside / between notes.

All thresholds live in ``SegmentParams`` so they can be tuned with Optuna on Kaggle.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import find_peaks
from taber_ir.models import NoteEvent, Technique

from .f0 import F0Result
from .ingest import Audio


@dataclass
class SegmentParams:
    jump_semitones: float = 0.45  # deviation from the run's rolling median that starts a new note
    confirm_frames_s: float = 0.009  # ...if it persists this long
    max_gap_s: float = 0.015  # unvoiced gap tolerated inside a note
    min_note_s: float = 0.08
    silence_db: float = 51.0  # frames this far below the loud parts are unvoiced (PESTO never says unvoiced)
    onset_search_before_s: float = 0.08
    onset_search_after_s: float = 0.035
    repick_height: float = 0.25  # normalised flux peak that splits a same-pitch run
    repick_min_gap_s: float = 0.10
    repick_tail_s: float = 0.040
    detect_legato: bool = False  # hammer-on / pull-off from audio needs a classifier trained on real takes
    legato_attack_db: float = 3.0  # high-band click (dB) below which a note counts as not picked
    strong_attack_db: float = 7.0  # broadband level rise (dB) that alone proves a pick attack
    attack_pre_s: tuple[float, float] = (0.050, 0.010)
    attack_post_s: float = 0.040
    init_pitch_s: tuple[float, float] = (0.015, 0.060)  # window for the fretted (pre-bend) pitch
    merge_flux: float = 0.35  # same-pitch fragments merge only if the flux peak is also weak
    glide_min_s: float = 0.018  # intermediate-pitch time that makes a transition a slide
    glide_min_semitones: float = 1.5
    min_conf: float = 0.23
    # techniques
    bend_min_semitones: float = 0.8
    vibrato_min_semitones: float = 0.15
    vibrato_hz: tuple[float, float] = (3.5, 9.0)
    vibrato_band_ratio: float = 0.40
    vibrato_periodicity: float = 0.45
    whammy_min_semitones: float = 0.7
    tuning_snap_cents: float = 12.0
    # scale prior (used only when segment() gets a scale, e.g. from the detected key)
    scale_snap: float = 0.0  # semitones of extra distance charged to an out-of-scale pitch when rounding
    scale_prune_conf: float = 0.0  # out-of-scale notes below this confidence...
    scale_prune_s: float = 0.0  # ...and shorter than this are dropped


@dataclass
class _Run:
    a: int
    b: int  # exclusive
    ref: float = 0.0


@dataclass
class Segmentation:
    notes: list[NoteEvent]
    tuning_offset_cents: float
    env_times: np.ndarray
    env: np.ndarray
    warnings: list[str] = field(default_factory=list)


# ───────────────────────────── helpers ─────────────────────────────
def _fill_gaps(m: np.ndarray, max_gap: int) -> np.ndarray:
    m = m.copy()
    v = ~np.isnan(m)
    idx = np.flatnonzero(v)
    if len(idx) < 2:
        return m
    for a, b in zip(idx[:-1], idx[1:]):
        g = b - a - 1
        if 0 < g <= max_gap and abs(m[b] - m[a]) < 1.0:
            m[a + 1 : b] = np.interp(np.arange(a + 1, b), [a, b], [m[a], m[b]])
    return m


def _median_smooth(m: np.ndarray, k: int = 5) -> np.ndarray:
    out = m.copy()
    n = len(m)
    h = k // 2
    for i in range(n):
        if np.isnan(m[i]):
            continue
        w = m[max(0, i - h) : i + h + 1]
        w = w[~np.isnan(w)]
        out[i] = np.median(w)
    return out


def _onset_envelope(audio: Audio, grid_times: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import librosa

    hop = 128 if audio.sr <= 24000 else 256
    env = librosa.onset.onset_strength(
        y=audio.y, sr=audio.sr, hop_length=hop, n_fft=1024, lag=2, max_size=3,
        fmin=100, fmax=min(5000, audio.sr / 2 - 100),
    )
    env_t = librosa.frames_to_time(np.arange(len(env)), sr=audio.sr, hop_length=hop)
    scale = np.percentile(env, 98) + 1e-9
    env = env / scale
    return env_t, np.interp(grid_times, env_t, env), env  # type: ignore[return-value]


def _frame_rms_db(audio: Audio, grid_times: np.ndarray) -> np.ndarray:
    import librosa

    hop = 128 if audio.sr <= 24000 else 256
    rms = librosa.feature.rms(y=audio.y, frame_length=1024, hop_length=hop)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=audio.sr, hop_length=hop)
    return np.interp(grid_times, t, 20 * np.log10(rms + 1e-9))


def _hf_envelope(audio: Audio, lo_hz: float = 2500.0, hi_hz: float = 7000.0) -> tuple[np.ndarray, np.ndarray]:
    """High-band energy (dB) at ~3 ms resolution: the pick 'click' that a hammer-on lacks."""
    import librosa

    n_fft, hop = 512, 64
    S = np.abs(librosa.stft(audio.y, n_fft=n_fft, hop_length=hop, center=True)) ** 2
    freqs = librosa.fft_frequencies(sr=audio.sr, n_fft=n_fft)
    band = (freqs >= lo_hz) & (freqs <= min(hi_hz, audio.sr / 2 - 200))
    e = S[band].sum(axis=0)
    t = librosa.frames_to_time(np.arange(len(e)), sr=audio.sr, hop_length=hop)
    return t, 10 * np.log10(e + 1e-12)


def _click_rise(hf_t: np.ndarray, hf_db: np.ndarray, onset: float) -> float:
    """Largest local rise (dB) of the high-band energy around ``onset``.

    The onset from spectral flux lags the real pick attack by up to ~20 ms, so the search
    window leans into the past; the baseline is the median level 25-70 ms before each frame.
    """
    hop = float(hf_t[1] - hf_t[0]) if len(hf_t) > 1 else 0.003
    k0 = int(np.searchsorted(hf_t, onset - 0.045))
    k1 = int(np.searchsorted(hf_t, onset + 0.010))
    b0, b1 = int(0.070 / hop), int(0.025 / hop)
    best = -60.0
    seen = False
    for k in range(max(k0, b0), min(k1, len(hf_db))):
        base = hf_db[k - b0 : k - b1]
        if len(base):
            best = max(best, float(hf_db[k] - np.median(base)))
            seen = True
    return best if seen else 60.0  # clip start: treat as picked


def _round_pitch(pitch_f: float, scale: frozenset[int] | None, snap: float) -> int:
    """Nearest semitone; with a scale, an out-of-scale semitone counts as `snap` further away."""
    if scale is None or snap <= 0:
        return int(round(pitch_f))
    lo = int(np.floor(pitch_f))
    cost = [abs(pitch_f - n) + (snap if n % 12 not in scale else 0.0) for n in (lo, lo + 1)]
    return lo if cost[0] <= cost[1] else lo + 1


def _split_runs(m: np.ndarray, hop: float, p: SegmentParams) -> list[_Run]:
    confirm = max(int(round(p.confirm_frames_s / hop)), 2)
    max_gap = max(int(round(p.max_gap_s / hop)), 1)
    runs: list[_Run] = []
    n = len(m)
    i = 0
    cur: _Run | None = None
    gap = 0
    hist: list[float] = []
    pending = 0
    while i < n:
        x = m[i]
        if np.isnan(x):
            gap += 1
            if cur is not None and gap > max_gap:
                cur.b = i - gap + 1
                runs.append(cur)
                cur, hist, pending = None, [], 0
            i += 1
            continue
        if cur is None:
            cur = _Run(i, i + 1, x)
            hist = [x]
            gap = pending = 0
            i += 1
            continue
        gap = 0
        ref = float(np.median(hist[-8:]))
        if abs(x - ref) > p.jump_semitones:
            pending += 1
            if pending >= confirm:
                start = i - pending + 1
                cur.b = start
                runs.append(cur)
                cur = _Run(start, i + 1, x)
                hist = [float(v) for v in m[start : i + 1] if not np.isnan(v)]
                pending = 0
        else:
            pending = 0
            hist.append(x)
        i += 1
    if cur is not None:
        cur.b = n - gap if gap else n
        runs.append(cur)
    return [r for r in runs if r.b > r.a]


def _contour_stats(c: np.ndarray, hop: float, p: SegmentParams) -> dict:
    """Vibrato detection on a pitch contour c (semitones)."""
    out = {"vibrato": False}
    n = len(c)
    if n * hop < 0.25:
        return out
    x = c[~np.isnan(c)]
    if len(x) < 0.25 / hop:
        return out
    x = x - np.polyval(np.polyfit(np.arange(len(x)), x, 3), np.arange(len(x)))  # remove trend / bend ramp
    if np.std(x) < p.vibrato_min_semitones / 2:
        return out
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)), n=4096)) ** 2
    freqs = np.fft.rfftfreq(4096, hop)
    band = (freqs >= p.vibrato_hz[0]) & (freqs <= p.vibrato_hz[1])
    total = spec[freqs >= 1.0].sum() + 1e-12
    ratio = spec[band].sum() / total
    amp = (np.percentile(x, 92) - np.percentile(x, 8)) / 2  # robust peak amplitude
    # periodic: normalised autocorrelation peak at a lag inside the vibrato period range
    xc = x - x.mean()
    ac = np.correlate(xc, xc, mode="full")[len(xc) - 1 :]
    ac = ac / (ac[0] + 1e-12)
    ac = ac * len(xc) / np.maximum(len(xc) - np.arange(len(ac)), 1)  # unbiased: short notes still count
    lo, hi = int(1.0 / p.vibrato_hz[1] / hop), int(1.0 / p.vibrato_hz[0] / hop) + 1
    periodic = bool(hi < len(ac) and lo < hi and ac[lo:hi].max() >= p.vibrato_periodicity)
    out["vibrato"] = bool(ratio >= p.vibrato_band_ratio and amp >= p.vibrato_min_semitones and periodic)
    return out


# ───────────────────────────── segmenter ─────────────────────────────
class F0FirstSegmenter:
    name = "f0_first"

    def __init__(self, params: SegmentParams | None = None):
        self.p = params or SegmentParams()

    def segment(
        self, audio: Audio, f0: F0Result, detect_techniques: bool = True, scale: frozenset[int] | None = None
    ) -> Segmentation:
        p, hop = self.p, f0.hop_s
        t = f0.times
        rms_db = _frame_rms_db(audio, t)
        f0_midi = f0.midi.copy()
        f0_midi[rms_db < np.percentile(rms_db, 98) - p.silence_db] = np.nan
        m_raw = _fill_gaps(f0_midi, max(int(round(0.018 / hop)), 1))
        m = _median_smooth(m_raw, 5)
        env_t, env_grid, env_raw = _onset_envelope(audio, t)
        hf_t, hf_db = _hf_envelope(audio)
        conf = f0.conf

        # 1) pitch runs (+ tiny runs that may be slide intermediates)
        runs = _split_runs(m, hop, p)
        min_frames = max(int(round(p.min_note_s / hop)), 2)

        # 2) tuning offset from the stable runs
        devs = []
        for r in runs:
            if r.b - r.a >= 3 * min_frames:
                seg = m[r.a : r.b]
                seg = seg[~np.isnan(seg)]
                if len(seg):
                    d = float(np.median(seg))
                    devs.append((d - round(d)) * 100)
        tuning_off = float(np.median(devs)) if len(devs) >= 3 else 0.0
        if abs(tuning_off) < p.tuning_snap_cents:
            tuning_off = 0.0
        shift = tuning_off / 100.0

        # 3) split runs at strong re-picks, build candidate notes
        cands: list[dict] = []
        for ri, r in enumerate(runs):
            a, b = r.a, r.b
            splits = [a]
            lo = a + int(p.repick_min_gap_s / hop)
            hi = b - int(p.repick_tail_s / hop)
            if hi > lo:
                seg = env_grid[lo:hi]
                peaks, props = find_peaks(seg, height=p.repick_height, distance=int(p.repick_min_gap_s / hop))
                for pk in peaks:
                    k = lo + int(pk)
                    # a real re-pick shows an energy dip beforehand or a flux spike well above the neighbours
                    splits.append(max(k - int(0.012 / hop), splits[-1] + 1))
            splits.append(b)
            for s0, s1 in zip(splits[:-1], splits[1:]):
                cands.append({"a": s0, "b": s1, "run": ri, "first_of_run": s0 == a})

        notes: list[dict] = []
        for c in cands:
            a, b = c["a"], c["b"]
            dur = (b - a) * hop
            seg = m[a:b]
            vseg = seg[~np.isnan(seg)]
            if len(vseg) == 0:
                continue
            c["tiny"] = dur < p.min_note_s
            # onset refinement: strongest flux peak around the run start
            lo_t, hi_t = t[a] - p.onset_search_before_s, t[a] + p.onset_search_after_s
            win = (env_t >= lo_t) & (env_t <= hi_t)
            if win.any():
                k = int(np.argmax(env_raw[win]))
                strength = float(env_raw[win][k])
                onset = float(env_t[win][k]) if strength >= 0.25 else float(t[a]) - 0.010
            else:
                strength, onset = 0.0, float(t[a])
            c["flux"] = float(np.clip(strength, 0.0, 1.5))
            c["onset"] = max(onset, 0.0)
            # picked vs legato: energy rise around the onset (a pitch change alone makes spectral
            # flux jump, but does not raise the level the way a pick attack does)
            oi = int(np.searchsorted(t, c["onset"]))
            pre = rms_db[max(oi - int(p.attack_pre_s[0] / hop), 0) : max(oi - int(p.attack_pre_s[1] / hop), 1)]
            post = rms_db[oi : oi + max(int(p.attack_post_s / hop), 2)]
            pre_db = float(np.median(pre)) if len(pre) else -90.0
            c["level_rise_db"] = float(np.max(post) - pre_db) if len(post) else 0.0
            o = c["onset"]
            hf_rise = _click_rise(hf_t, hf_db, o)
            c["attack_db"] = hf_rise
            c["picked"] = bool(hf_rise >= p.legato_attack_db or c["level_rise_db"] >= p.strong_attack_db)
            c["strength"] = float(np.clip(c["attack_db"] / 20.0, 0.0, 1.0))
            # initial pitch: settled part right after the attack, before a bend has gone far
            i0 = a + int(p.init_pitch_s[0] / hop)
            i1 = min(a + int(p.init_pitch_s[1] / hop), b)
            init = m[i0:i1] if i1 - i0 >= 3 else seg
            init = init[~np.isnan(init)]
            if len(init) == 0:
                init = vseg
            pitch_f = float(np.median(init)) - shift
            c["pitch_f"] = pitch_f
            c["pitch"] = _round_pitch(pitch_f, scale, p.scale_snap)
            c["cents"] = float((pitch_f - c["pitch"]) * 100)
            c["conf"] = float(np.nanmean(conf[a:b]) * (len(vseg) / max(b - a, 1)))
            c["rms"] = float(np.nanmax(rms_db[a:b]))
            notes.append(c)

        real = [c for c in notes if not c["tiny"] and c["conf"] >= p.min_conf]
        if scale is not None and p.scale_prune_conf > 0:
            real = [
                c for c in real
                if c["pitch"] % 12 in scale or c["conf"] >= p.scale_prune_conf or (c["b"] - c["a"]) * hop >= p.scale_prune_s
            ]

        # 5) clean-ups: octave glitches, merge same-pitch fragments
        cleaned: list[dict] = []
        for i, c in enumerate(real):
            prev_c = real[i - 1] if i > 0 else None
            next_c = real[i + 1] if i + 1 < len(real) else None
            dur = (c["b"] - c["a"]) * hop
            if prev_c and next_c and dur < 0.10:
                if abs(c["pitch"] - prev_c["pitch"]) >= 11 and abs(c["pitch"] - next_c["pitch"]) >= 11:
                    continue
            if cleaned:
                q = cleaned[-1]
                same = q["pitch"] == c["pitch"]
                contiguous = (c["a"] - q["b"]) * hop <= 0.04
                # fragments of one sustained note: no energy rise AND no pick transient
                if same and contiguous and not c["picked"] and c["flux"] < p.merge_flux:
                    q["b"] = c["b"]
                    continue
            cleaned.append(c)

        # 5b) slide = the transition passes through intermediate pitches (a jump does not)
        for i in range(1, len(cleaned)):
            q, c = cleaned[i - 1], cleaned[i]
            lo, hi = sorted((q["pitch_f"], c["pitch_f"]))
            if hi - lo < p.glide_min_semitones:
                continue
            i0 = max(c["a"] - int(0.10 / hop), q["a"])
            i1 = min(c["a"] + int(0.10 / hop), c["b"])
            seg_raw = m_raw[i0:i1]
            inter = np.sum((seg_raw > lo + 0.5) & (seg_raw < hi - 0.5))
            if inter * hop >= p.glide_min_s:
                c["glide"] = float(inter * hop)

        # 6) build NoteEvents + techniques
        out: list[NoteEvent] = []
        for i, c in enumerate(cleaned):
            a, b = c["a"], c["b"]
            prev_c = cleaned[i - 1] if i > 0 else None
            techs: list[Technique] = []
            nxt_c = cleaned[i + 1] if i + 1 < len(cleaned) else None
            trim = 0
            if nxt_c is not None and ("glide" in nxt_c or not nxt_c["picked"]):
                trim = int((nxt_c.get("glide", 0.0) + 0.05) / hop)
            contour = (m[a:b] - shift - c["pitch_f"])
            contour = contour[: max(len(contour) - trim, 4)]
            if detect_techniques:
                techs = self._techniques(c, prev_c, contour, hop)
            offset = float(t[b - 1] + hop)
            nxt_on = cleaned[i + 1]["onset"] if i + 1 < len(cleaned) else None
            if nxt_on is not None:
                offset = min(offset, nxt_on) if nxt_on > c["onset"] + 0.02 else offset
            offset = max(offset, c["onset"] + 0.03)
            vel = float(np.clip((c["rms"] + 45.0) / 35.0, 0.15, 1.0))
            out.append(
                NoteEvent(
                    id=f"n{i}",
                    onset_s=round(c["onset"], 4),
                    offset_s=round(offset, 4),
                    pitch_midi=int(c["pitch"]),
                    pitch_cents=round(c["cents"], 1),
                    velocity=round(vel, 3),
                    onset_strength=round(min(c["strength"], 1.0), 3),
                    confidence=round(float(np.clip(c["conf"], 0, 1)), 3),
                    techniques=techs,
                )
            )
        return Segmentation(out, tuning_off, env_t, env_raw)

    # ───────── technique rules ─────────
    def _techniques(self, c: dict, prev_c: dict | None, contour: np.ndarray, hop: float) -> list[Technique]:
        p = self.p
        techs: list[Technique] = []
        # arrival technique
        if prev_c is not None:
            gap = c["onset"] - prev_c["onset"]
            delta = c["pitch"] - prev_c["pitch"]
            legato = not c["picked"]
            if "glide" in c:
                strong = c["level_rise_db"] >= p.strong_attack_db
                techs.append(Technique(type="slide_shift" if strong else "slide_legato", confidence=0.6))
            elif p.detect_legato and legato and delta != 0 and abs(delta) <= 7 and gap < 1.5:
                techs.append(Technique(type="hammer_on" if delta > 0 else "pull_off", confidence=0.6))

        v = contour[~np.isnan(contour)]
        if len(v) >= 4:
            tail = v[len(v) // 2 :]
            peak = float(np.percentile(v, 92))  # robust to single-frame glitches
            trough = float(np.percentile(v, 8))
            end = float(np.median(tail))
            vib = _contour_stats(contour, hop, p)["vibrato"]
            if peak >= p.bend_min_semitones and not (vib and peak < 1.0):
                val = float(np.clip(round(peak / 2.0 * 4) / 4, 0.25, 2.0))
                techs.append(Technique(type="bend", value=val, confidence=0.55))
                if end < 0.35 * peak:
                    techs.append(Technique(type="release", value=val, confidence=0.4))
            elif trough <= -p.whammy_min_semitones:
                val = float(np.clip(round(trough / 2.0 * 4) / 4, -2.0, -0.25))
                techs.append(Technique(type="whammy", value=val, confidence=0.4))
            if vib:
                techs.append(Technique(type="vibrato", confidence=0.6))
        return techs

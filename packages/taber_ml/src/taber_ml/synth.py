"""Additive electric-guitar synthesizer with optional distortion (tests / eval / demos).

Not meant to sound great; it must be *plausible enough* for a transcriber: harmonic-rich,
plucked envelope with pick noise, legato notes without a new attack, bends / vibrato /
slides / whammy dips as continuous pitch contours, then soft clipping + cabinet filter.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt
from taber_ir.models import NoteEvent

SR = 44100
TONE_GAIN = {"clean": 0.0, "distortion_light": 4.0, "high_gain": 14.0}
PICK_CLICK = 1.4  # pick transient amplitude relative to the harmonic content (real picks click clearly)
LEGATO = {"hammer_on", "pull_off", "slide_legato", "slide_shift"}


def _tech(n: NoteEvent, kind: str):
    for t in n.techniques:
        if t.type == kind:
            return t
    return None


def _pitch_contour_semitones(n: NoteEvent, length: int, sr: int, prev: NoteEvent | None) -> np.ndarray:
    """Offset (in semitones) from the note's fretted pitch over its length."""
    t = np.arange(length) / sr
    dur = max(length / sr, 1e-3)
    c = np.zeros(length)
    b = _tech(n, "bend")
    if b is not None:
        amt = (b.value if b.value is not None else 1.0) * 2.0
        rise = min(0.35 * dur, 0.35)
        c += amt * np.clip(t / max(rise, 1e-3), 0, 1)
    if _tech(n, "prebend") is not None:
        pb = _tech(n, "prebend")
        c += (pb.value or 1.0) * 2.0
    r = _tech(n, "release")
    if r is not None:
        amt = (r.value if r.value is not None else 1.0) * 2.0
        c += amt * (1 - np.clip((t - 0.4 * dur) / max(0.3 * dur, 1e-3), 0, 1))
    if _tech(n, "vibrato") is not None:
        start = min(0.25 * dur, 0.3)
        depth = 0.30
        env = np.clip((t - start) / 0.15, 0, 1)
        c += depth * env * np.sin(2 * np.pi * 5.5 * t)
    w = _tech(n, "whammy")
    if w is not None:
        amt = (w.value if w.value is not None else -1.0) * 2.0
        c += amt * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    if prev is not None and _tech(n, "slide_legato") is not None:
        glide = int(0.06 * sr)
        delta = (prev.pitch_midi - n.pitch_midi)
        ramp = np.clip(1 - np.arange(length) / max(glide, 1), 0, 1)
        c += delta * ramp
    return c


def render(
    notes: list[NoteEvent],
    sr: int = SR,
    tone: str = "distortion_light",
    tail_s: float = 0.6,
    noise_db: float = -62.0,
    seed: int = 0,
    sustain_tau: float = 1.1,
) -> np.ndarray:
    rnd = np.random.default_rng(seed)
    notes = sorted(notes, key=lambda n: n.onset_s)
    total = int((max((n.offset_s for n in notes), default=1.0) + tail_s) * sr)
    out = np.zeros(total, dtype=np.float64)
    prev: NoteEvent | None = None
    prev_level = 1.0
    for n in notes:
        start = int(n.onset_s * sr)
        legato = any(_tech(n, k) is not None for k in LEGATO) and prev is not None
        # a legato note continues the previous one; the previous note stops where this one begins
        length = max(int((n.offset_s - n.onset_s) * sr), int(0.04 * sr))
        length = min(length, total - start)
        if length <= 0:
            continue
        t = np.arange(length) / sr
        f0 = 440.0 * 2 ** ((n.pitch_midi + n.pitch_cents / 100.0 - 69) / 12.0)
        semis = _pitch_contour_semitones(n, length, sr, prev)
        inst_f = f0 * 2 ** (semis / 12.0)
        phase = 2 * np.pi * np.cumsum(inst_f) / sr
        sig = np.zeros(length)
        kmax = int(min(14, (sr / 2 * 0.9) / f0))
        for k in range(1, max(kmax, 1) + 1):
            amp = 1.0 / (k ** 1.15) * (1.0 if k % 7 else 0.5)
            sig += amp * np.sin(k * phase + rnd.uniform(0, 2 * np.pi) * (k > 1))
        level = n.velocity if n.velocity else 0.8
        if legato:
            level = prev_level * 0.92 * (0.9 if _tech(n, "pull_off") is not None else 1.0)
            attack = int(0.004 * sr)
        else:
            attack = int(0.003 * sr)
        env = np.exp(-t / sustain_tau)
        env[:attack] *= np.linspace(0, 1, attack, endpoint=False) if attack else 1
        rel = min(int(0.03 * sr), length // 2)
        if rel:
            env[-rel:] *= np.linspace(1, 0, rel)
        sig = sig * env * level
        if not legato:  # pick noise burst
            nb = int(0.012 * sr)
            burst = rnd.standard_normal(nb) * np.exp(-np.arange(nb) / (0.004 * sr)) * PICK_CLICK * level
            sig[:nb] += burst[: min(nb, length)]
        if _tech(n, "palm_mute") is not None:
            sig *= np.exp(-t / 0.12)
        out[start : start + length] += sig
        prev, prev_level = n, level * float(env[length // 2])
    peak = np.max(np.abs(out)) or 1.0
    out /= peak
    gain = TONE_GAIN.get(tone, 0.0)
    if gain > 0:
        out = np.tanh(gain * out) / np.tanh(gain)
    sos = butter(4, 5200, btype="low", fs=sr, output="sos")  # cabinet-ish
    out = sosfilt(sos, out)
    out += rnd.standard_normal(len(out)) * 10 ** (noise_db / 20)
    out *= 0.7 / (np.max(np.abs(out)) or 1.0)
    return out.astype(np.float32)


def render_backing(duration_s: float, bpm: float, sr: int = SR, seed: int = 0, lead_in_s: float = 0.5,
                   root: int = 45) -> np.ndarray:
    """A plausible band behind a solo: drums (kick, snare, hats), a bass line and a sustained chord pad
    in the guitar's own register (the hard part for a pitch tracker). Mono float32."""
    rnd = np.random.default_rng(seed + 1000)
    n = int(duration_s * sr)
    out = np.zeros(n)
    spb = 60.0 / bpm
    t_all = np.arange(n) / sr

    def put(start: float, sig: np.ndarray) -> None:
        i = int(start * sr)
        if 0 <= i < n:
            m = min(len(sig), n - i)
            out[i : i + m] += sig[:m]

    beat = 0
    t = lead_in_s
    while t < duration_s:
        k = np.arange(int(0.25 * sr)) / sr
        if beat % 2 == 0:  # kick on 1 and 3: falling sine
            put(t, 0.9 * np.sin(2 * np.pi * (50 + 90 * np.exp(-k / 0.03)) * k) * np.exp(-k / 0.12))
        else:  # snare on 2 and 4
            put(t, 0.35 * rnd.standard_normal(len(k)) * np.exp(-k / 0.07))
        for h in (0.0, 0.5):  # hats on every eighth
            kk = np.arange(int(0.05 * sr)) / sr
            hat = rnd.standard_normal(len(kk))
            hat = np.diff(hat, prepend=0)  # crude high-pass
            put(t + h * spb, 0.08 * hat * np.exp(-kk / 0.015))
        beat += 1
        t += spb

    # bass: root, fifth, octave pattern, one note per beat (A1-ish register)
    pattern = [0, 0, 7, 12, 5, 5, 7, 7]
    t, i = lead_in_s, 0
    while t < duration_s:
        f = 440 * 2 ** ((root - 12 + pattern[i % len(pattern)] - 69) / 12)
        k = np.arange(int(spb * sr)) / sr
        sig = (np.sin(2 * np.pi * f * k) + 0.3 * np.sin(4 * np.pi * f * k)) * np.exp(-k / 0.6)
        put(t, 0.35 * sig)
        t += spb
        i += 1

    # pad: two-bar chords (i - VI - VII - i in A minor around A3), soft attack
    chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]]
    bar = 4 * spb
    t, i = lead_in_s, 0
    while t < duration_s:
        k = np.arange(int(2 * bar * sr)) / sr
        env = np.minimum(k / 0.15, 1.0) * np.minimum((2 * bar - k) / 0.2, 1.0)
        sig = np.zeros_like(k)
        for iv in chords[i % len(chords)]:
            f = 440 * 2 ** ((root + 12 + iv - 69) / 12)
            for h in range(1, 6):
                sig += np.sin(2 * np.pi * f * h * k + rnd.uniform(0, 6.28)) / h**1.5
        put(t, 0.06 * sig * env)
        t += 2 * bar
        i += 1
    del t_all
    return out.astype(np.float32)


def mix_with_backing(guitar: np.ndarray, backing: np.ndarray, backing_db: float = 0.0) -> np.ndarray:
    """Sum at a given backing level (RMS relative to the guitar), normalised to avoid clipping."""
    n = max(len(guitar), len(backing))
    g = np.pad(guitar, (0, n - len(guitar))).astype(np.float64)
    b = np.pad(backing, (0, n - len(backing))).astype(np.float64)
    rg, rb = np.sqrt(np.mean(g**2)) or 1.0, np.sqrt(np.mean(b**2)) or 1.0
    m = g + b * (rg / rb) * 10 ** (backing_db / 20)
    return (m * 0.8 / (np.max(np.abs(m)) or 1.0)).astype(np.float32)

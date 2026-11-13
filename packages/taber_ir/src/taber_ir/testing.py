"""Helpers to build ground-truth tabs and synthetic Analysis objects (tests, eval, demos)."""

from __future__ import annotations

import random
from dataclasses import dataclass

from .models import Analysis, BeatGrid, NoteEvent, Technique, Tuning
from .tuning import sounding_pitch


@dataclass
class TabNote:
    """A note of a known tab. start/dur are in beats (quarter notes)."""

    string: int
    fret: int
    start: float
    dur: float
    techniques: tuple = ()  # "bend" or ("bend", 1.0)


def pitch_of(n: TabNote, tuning: Tuning) -> int:
    return sounding_pitch(tuning, n.string, n.fret)


def analysis_from_tab(
    tab: list[TabNote],
    bpm: float = 120.0,
    tuning: Tuning | None = None,
    time_signature: str = "4/4",
    jitter_s: float = 0.0,
    seed: int = 0,
    with_beats: bool = True,
    lead_in_s: float = 0.5,
    n_beats: int | None = None,
) -> Analysis:
    """Build the Analysis a perfect transcriber would produce for ``tab``."""
    tuning = tuning or Tuning()
    rnd = random.Random(seed)
    spb = 60.0 / bpm
    notes: list[NoteEvent] = []
    for i, n in enumerate(sorted(tab, key=lambda x: (x.start, x.string))):
        on = lead_in_s + n.start * spb + (rnd.uniform(-jitter_s, jitter_s) if jitter_s else 0.0)
        off = lead_in_s + n.start * spb + n.dur * spb * 0.97
        notes.append(
            NoteEvent(
                id=f"n{i}",
                onset_s=max(on, 0.0),
                offset_s=max(off, on + 0.03),
                pitch_midi=pitch_of(n, tuning),
                techniques=[
                    Technique(type=t, value=None)  # type: ignore[arg-type]
                    if isinstance(t, str)
                    else Technique(type=t[0], value=t[1])
                    for t in n.techniques
                ],
            )
        )
    end_beat = max((n.start + n.dur for n in tab), default=4.0)
    nb = n_beats or int(end_beat) + 2
    grid = BeatGrid(time_signature=time_signature, tempo_bpm=bpm)
    if with_beats:
        num = int(time_signature.split("/")[0])
        grid.beats_s = [lead_in_s + k * spb for k in range(nb)]
        grid.downbeats_s = [lead_in_s + k * spb for k in range(0, nb, num)]
    return Analysis(notes=notes, beat_grid=grid)


def measure_units(measure) -> int:
    from .rhythm.beat_grid import parse_time_signature

    num, den = parse_time_signature(measure.time_signature)
    return num * 96 // den


def check_measures_full(score) -> None:
    """Assert every measure's slots add up to exactly the bar length (1/24-beat units)."""
    from .export.common import slot_units

    for m in score.measures:
        total = sum(slot_units(s) for s in m.slots)
        assert total == measure_units(m), f"measure {m.index}: {total} != {measure_units(m)}"

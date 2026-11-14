"""Ground truth from a tab the user has corrected (docs §12, "your own test set").

A corrected Score says *what* was played (pitch, string, fret, rhythm). Its timing comes from two
places, because the editor never moves a note in time:
- a note the machine detected (``note_id`` set) keeps the onset/offset the analysis measured;
  if the user changed its pitch or position, the time is still right.
- a note the user added has no measured time, only its slot on the beat grid. Its onset is less
  precise, so evaluation matches it with a wider tolerance (``timing == "grid"``).

The result is stored as ``truth.json`` next to copies of the input audio (see the API's truth
store) and read back by ``taber truth-eval``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .export.common import parse_ts, slot_units
from .models import Analysis, Score, Tuning

TRUTH_VERSION = "1"


class TruthNote(BaseModel):
    onset_s: float
    offset_s: float
    pitch_midi: int
    string: int
    fret: int
    beat: float  # position in quarter-note beats from the start of the score
    techniques: list[str] = Field(default_factory=list)
    timing: Literal["detected", "grid"] = "detected"
    note_id: str | None = None  # the score note's id: an analysis note, or "u..." for a note the user added


class TruthTake(BaseModel):
    version: str = TRUTH_VERSION
    title: str = ""
    transcription_id: str = ""
    revision: int = 0
    created_at: str = ""
    tuning: Tuning = Field(default_factory=Tuning)
    inputs: dict[str, str] = Field(default_factory=dict)  # role (wet/di/video) -> file name in the folder
    analysis_options: dict = Field(default_factory=dict)
    tempo_bpm: float | None = None
    notes: list[TruthNote] = Field(default_factory=list)


def truth_notes(score: Score, analysis: Analysis | None) -> list[TruthNote]:
    """Every sounding note of the score (tied continuations folded into their first note)."""
    by_id = {n.id: n for n in analysis.notes} if analysis else {}
    # flatten slots with their beat position and grid time, to find where tied chains end
    flat: list[tuple[float, float, object]] = []  # (beat, start_s, slot)
    origin = 0
    for m in score.measures:
        num, den = parse_ts(m.time_signature)
        u = origin
        for s in m.slots:
            flat.append((u / 24.0, s.start_s, s))
            u += slot_units(s)
        origin += num * 96 // den
    end_beat = origin / 24.0

    def slot_end_s(i: int) -> float:
        if i + 1 < len(flat):
            return flat[i + 1][1]
        beat, start, _s = flat[i]
        bpm = score.measures[-1].tempo_bpm if score.measures else 120.0
        return start + (end_beat - beat) * 60.0 / bpm

    out: list[TruthNote] = []
    for i, (beat, start_s, slot) in enumerate(flat):
        for n in slot.notes:  # type: ignore[attr-defined]
            if n.tie_from_prev:
                continue
            # follow ties on the same string to the end of the chain
            j = i
            while j + 1 < len(flat) and any(
                x.tie_from_prev and x.string == n.string for x in flat[j + 1][2].notes  # type: ignore[attr-defined]
            ):
                j += 1
            src = by_id.get(n.note_id) if n.note_id else None
            if src is not None:
                onset, offset, timing = src.onset_s, src.offset_s, "detected"
            else:
                onset, offset, timing = start_s, slot_end_s(j), "grid"
            out.append(TruthNote(
                onset_s=round(onset, 4), offset_s=round(max(offset, onset + 0.03), 4), pitch_midi=n.pitch_midi,
                string=n.string, fret=n.fret, beat=round(beat, 4), techniques=[t.type for t in n.techniques],
                timing=timing, note_id=n.note_id,
            ))
    out.sort(key=lambda t: (t.onset_s, t.string))
    return out

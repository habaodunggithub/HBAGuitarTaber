"""Shared helpers for exporters."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import Score, ScoreNote, Slot, Technique

# Techniques that describe how a note is *reached*. In Guitar Pro / alphaTab the flag lives on
# the ORIGIN note (the one before), so exporters need to look one slot back.
ARRIVAL_TECHS = {"hammer_on", "pull_off", "slide_legato", "slide_shift"}

QUARTER_TONES_PER_TONE = 4  # alphaTab / GP: bend value 4 == one whole tone


def slot_units(slot: Slot) -> int:
    """Length of a slot in 1/24-beat units."""
    base = 96 // int(slot.duration.split("/")[1])
    if slot.dotted:
        base = base * 3 // 2
    if slot.tuplet:
        base = base * slot.tuplet[1] // slot.tuplet[0]
    return base


def slot_beats(slot: Slot) -> float:
    return slot_units(slot) / 24.0


def parse_ts(ts: str) -> tuple[int, int]:
    n, d = ts.split("/")
    return int(n), int(d)


def quarter_tones(whole_tones: float | None) -> int:
    return int(round((whole_tones if whole_tones is not None else 1.0) * QUARTER_TONES_PER_TONE))


def tech(note: ScoreNote, kind: str) -> Technique | None:
    for t in note.techniques:
        if t.type == kind:
            return t
    return None


@dataclass
class Origin:
    """Flags that must be written on the origin note (previous slot)."""

    hammer: bool = False  # hammer-on or pull-off
    slide: str | None = None  # "legato" | "shift"
    slide_dir: int = 0  # +1 up, -1 down
    extra: set[str] = field(default_factory=set)


def compute_origins(score: Score) -> dict[tuple[int, int, int], Origin]:
    """Map (measure_idx, slot_idx, note_idx) -> Origin flags for arrival techniques.

    A note carrying hammer_on / pull_off / slide_* means: it is reached from the
    immediately previous slot on the same string. If there is no such note (rest in
    between, other string) the technique is ignored.
    """
    flat: list[tuple[int, int, Slot]] = []
    for m in score.measures:
        for si, s in enumerate(m.slots):
            flat.append((m.index, si, s))
    out: dict[tuple[int, int, int], Origin] = {}
    for k in range(1, len(flat)):
        mi, si, slot = flat[k]
        pmi, psi, prev = flat[k - 1]
        if not prev.notes:
            continue
        for note in slot.notes:
            if note.tie_from_prev:
                continue
            kinds = {t.type for t in note.techniques} & ARRIVAL_TECHS
            if not kinds:
                continue
            for pi, pn in enumerate(prev.notes):
                if pn.string != note.string:
                    continue
                o = out.setdefault((pmi, psi, pi), Origin())
                if kinds & {"hammer_on", "pull_off"}:
                    o.hammer = True
                    o.extra.add("hammer_on" if "hammer_on" in kinds else "pull_off")
                if "slide_legato" in kinds:
                    o.slide = "legato"
                    o.slide_dir = 1 if note.fret > pn.fret else -1
                if "slide_shift" in kinds:
                    o.slide = "shift"
                    o.slide_dir = 1 if note.fret > pn.fret else -1
    return out

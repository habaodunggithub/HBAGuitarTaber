"""alphaTex serializer (verified against alphaTab 1.9 parser).

Facts established against the real parser:
- alphaTex string numbering: 1 = highest, 6 = lowest (same as our convention).
- `\\tuning` lists note names high -> low, e.g. `e4 b3 g3 d3 a2 e2`.
- bend: `{b (v0 v1 v2 ...)}` values only, evenly spaced, 4 = one whole tone.
- hammer / slide flags go on the ORIGIN note: `{h}`, `{sl}` legato, `{ss}` shift.
- `\\tempo N` and `\\ts n d` may appear at the start of a bar body.
"""

from __future__ import annotations

from ..models import Score, ScoreNote
from ..tuning import NOTE_NAMES, num_strings, open_pitch
from .common import Origin, compute_origins, parse_ts, quarter_tones, tech


def _tex_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12].lower()}{midi // 12 - 1}"  # e4 = 64, c#4 = 61


def _note_effects(note: ScoreNote, origin: Origin | None) -> list[str]:
    eff: list[str] = []
    if origin:
        if origin.hammer:
            eff.append("h")
        if origin.slide:
            eff.append("sl" if origin.slide == "legato" else "ss")
    for t in note.techniques:
        q = quarter_tones(t.value)
        if t.type == "bend":
            eff.append(f"b (0 {q} {q})")
        elif t.type == "prebend":
            eff.append(f"b ({q} {q})")
        elif t.type == "release":
            eff.append(f"b ({q} {q} 0)")
        elif t.type == "vibrato":
            eff.append("v")
        elif t.type == "palm_mute":
            eff.append("pm")
        elif t.type == "let_ring":
            eff.append("lr")
        elif t.type == "harmonic_natural":
            eff.append("nh")
        elif t.type == "harmonic_pinch":
            eff.append("ph")
        elif t.type == "tap":
            eff.append("tp")
        elif t.type == "slide_in":
            eff.append("sib")
        elif t.type == "slide_out":
            eff.append("sou" if (t.value or 1) >= 0 else "sod")
    return eff


def _note_token(note: ScoreNote, origin: Origin | None, in_chord: bool) -> str:
    if note.tie_from_prev:
        base = f"-.{note.string}"
    elif tech(note, "dead_note"):
        base = f"x.{note.string}"
    else:
        base = f"{note.fret}.{note.string}"
    eff = _note_effects(note, origin) if not note.tie_from_prev else []
    return base + (" {" + " ".join(eff) + "}" if eff else "")


def score_to_alphatex(score: Score) -> str:
    tuning = score.assembly_params.tuning
    origins = compute_origins(score)
    title = score.title.replace('"', "'")
    first_tempo = score.measures[0].tempo_bpm if score.measures else 120.0
    lines = [f'\\title "{title}"', f"\\tempo {round(first_tempo)}"]
    names = " ".join(_tex_name(open_pitch(tuning, s)) for s in range(1, num_strings(tuning) + 1))
    lines.append(f"\\tuning {names}")
    if tuning.capo:
        lines.append(f"\\capo {tuning.capo}")
    lines.append(".")

    prev_ts = None
    prev_tempo = round(first_tempo)
    for m in score.measures:
        head: list[str] = []
        if m.time_signature != prev_ts:
            n, d = parse_ts(m.time_signature)
            head.append(f"\\ts {n} {d}")
            prev_ts = m.time_signature
        tempo = round(m.tempo_bpm)
        if m.index > 0 and abs(tempo - prev_tempo) >= 2:
            head.append(f"\\tempo {tempo}")
            prev_tempo = tempo
        toks: list[str] = []
        for si, slot in enumerate(m.slots):
            dur = slot.duration.split("/")[1]
            beat_fx = []
            if slot.dotted:
                beat_fx.append("d")
            if slot.tuplet:
                beat_fx.append(f"tu {slot.tuplet[0]}")
            if any(tech(n, "whammy") for n in slot.notes):
                w = next(tech(n, "whammy") for n in slot.notes if tech(n, "whammy"))
                q = quarter_tones(w.value if w and w.value is not None else -1.0)
                beat_fx.append(f"tbe (0 0 30 {q} 60 0)")
            # alphaTex allows one beat-effect group per beat: `(3.3 6.5) {d} {tbe ...}` does not parse
            fx = (" {" + " ".join(beat_fx) + "}") if beat_fx else ""
            if not slot.notes:
                body = "r"
            elif len(slot.notes) == 1:
                body = _note_token(slot.notes[0], origins.get((m.index, si, 0)), False)
            else:
                inner = " ".join(
                    _note_token(n, origins.get((m.index, si, ni)), True)
                    for ni, n in enumerate(slot.notes)
                )
                body = f"({inner})"
            toks.append(f":{dur} {body}{fx}")
        lines.append(" ".join(head + toks) + " |")
    return "\n".join(lines) + "\n"

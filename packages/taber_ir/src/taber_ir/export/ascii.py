"""ASCII tab renderer."""

from __future__ import annotations

from ..models import Score
from ..tuning import NOTE_NAMES, num_strings, open_pitch
from .common import compute_origins, slot_units, tech


def _label(midi: int) -> str:
    n = NOTE_NAMES[midi % 12]
    return n.lower() if midi >= 64 else n  # e B G D A E  convention


def score_to_ascii(score: Score, width: int = 80) -> str:
    tuning = score.assembly_params.tuning
    n_str = num_strings(tuning)
    origins = compute_origins(score)
    labels = [_label(open_pitch(tuning, s)) for s in range(1, n_str + 1)]
    lw = max(len(x) for x in labels)

    # Render every measure into per-string strings of equal length.
    blocks: list[tuple[str, list[str]]] = []
    for m in score.measures:
        cols: list[list[str]] = [[] for _ in range(n_str)]
        for si, slot in enumerate(m.slots):
            cells = ["" for _ in range(n_str)]
            for ni, note in enumerate(slot.notes):
                if note.tie_from_prev:
                    continue  # sustained: leave the cell empty
                text = str(note.fret)
                if tech(note, "dead_note"):
                    text = "x"
                o = origins.get((m.index, si, ni))
                if o and o.hammer:
                    text += "p" if "pull_off" in o.extra else "h"
                elif o and o.slide:
                    text += "/" if o.slide_dir > 0 else "\\"
                if tech(note, "bend") or tech(note, "prebend"):
                    text += "b"
                if tech(note, "release"):
                    text += "r"
                if tech(note, "vibrato"):
                    text += "~"
                if tech(note, "whammy"):
                    text += "w"
                cells[note.string - 1] = text
            w = max(max((len(c) for c in cells), default=1) + 1, slot_units(slot) // 4 + 1)
            for s in range(n_str):
                c = cells[s]
                cols[s].append(c + "-" * (w - len(c)))
        body = ["".join(c) for c in cols]
        head = f"{m.index + 1}  {m.time_signature}  ♩={m.tempo_bpm:g}"
        blocks.append((head, body))

    lines: list[str] = []
    cur_head: list[str] = []
    cur: list[list[str]] = [[] for _ in range(n_str)]
    cur_len = lw + 1

    def flush() -> None:
        nonlocal cur_head, cur, cur_len
        if not cur_head:
            return
        lines.append("   ".join(cur_head))
        for s in range(n_str):
            lines.append(f"{labels[s]:>{lw}}|" + "|".join(cur[s]) + "|")
        lines.append("")
        cur_head, cur, cur_len = [], [[] for _ in range(n_str)], lw + 1

    for head, body in blocks:
        blen = len(body[0]) + 1
        if cur_head and cur_len + blen > width:
            flush()
        cur_head.append(head)
        for s in range(n_str):
            cur[s].append(body[s])
        cur_len += blen
    flush()
    return "\n".join(lines).rstrip() + "\n"

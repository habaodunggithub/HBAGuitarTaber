"""IDMT-SMT-Guitar V2 (Fraunhofer IDMT, CC BY-NC-ND 4.0): electric guitar with string/fret labels.

Download https://zenodo.org/records/7544110 and unzip into <root> (giving <root>/IDMT-SMT-GUITAR_V2).
The license forbids derivatives, so this project uses it **for evaluation only**, never for training.
That also keeps it a fair held-out test: none of the models here (Basic Pitch included) saw it.

dataset2 holds short recordings on three electric guitars (AR = Aristides, FS = Fender Strat,
LP = Gibson Les Paul): chromatic scales, single techniques, and licks (``*Lick*``) that mix
bends, slides, vibrato, hammer-ons, pull-offs and dead notes. IDMT numbers strings from the low E
(string 1 = E2); ours is the reverse (string 1 = high e), so ours = 7 - theirs.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from taber_ir.models import NoteEvent


@dataclass
class IdmtTake:
    name: str
    guitar: str  # AR | FS | LP
    audio: Path
    xml: Path

    def reference(self, drop_dead: bool = True) -> tuple[list[NoteEvent], list[tuple[int, int]], list[str]]:
        """Reference notes sorted by onset, their (string, fret) in our convention, their expression style."""
        rows = []
        for ev in ET.parse(self.xml).getroot().iter("event"):
            style = (ev.findtext("expressionStyle") or "NO").strip()
            if drop_dead and style == "DN":  # dead notes have no pitch
                continue
            on = float(ev.findtext("onsetSec") or 0)
            off = float(ev.findtext("offsetSec") or on + 0.1)
            pitch = int(round(float(ev.findtext("pitch") or 0)))
            string = 7 - int(ev.findtext("stringNumber") or 0)
            fret = int(ev.findtext("fretNumber") or 0)
            rows.append((on, off, pitch, string, fret, style))
        rows.sort()
        notes = [NoteEvent(id=f"r{i}", onset_s=a, offset_s=max(b, a + 0.03), pitch_midi=p) for i, (a, b, p, *_r) in enumerate(rows)]
        return notes, [(s, f) for *_x, s, f, _st in rows], [r[-1] for r in rows]


def takes(root: str | Path, pattern: str = "*Lick*") -> list[IdmtTake]:
    base = Path(root).expanduser()
    if (base / "IDMT-SMT-GUITAR_V2").is_dir():
        base = base / "IDMT-SMT-GUITAR_V2"
    d2 = base / "dataset2"
    out = []
    for wav in sorted((d2 / "audio").glob(f"{pattern}.wav")):
        xml = d2 / "annotation" / (wav.stem + ".xml")
        if xml.exists():
            out.append(IdmtTake(wav.stem, wav.stem.split("_")[0], wav, xml))
    return out

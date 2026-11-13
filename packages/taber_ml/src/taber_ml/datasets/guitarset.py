"""GuitarSet (Xi et al., ISMIR 2018, CC BY 4.0): real guitar with per-string note annotations.

Download from https://zenodo.org/records/3371780 and unzip ``annotation.zip`` into <root>/ann and
``audio_mono-mic.zip`` into <root>/audio. Standard tuning throughout.

The six ``note_midi`` annotations of a JAMS file are in string order low E -> high e, i.e. annotation
k is our string 6 - k (string 1 = highest).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from taber_ir.models import NoteEvent, Tuning
from taber_ir.tuning import open_pitch

PLAYERS = ["00", "01", "02", "03", "04", "05"]


@dataclass
class Take:
    name: str  # e.g. 03_Rock1-90-C#_solo
    player: str
    style: str
    bpm: float
    kind: str  # "solo" | "comp"
    audio: Path
    jams: Path

    def key(self) -> str | None:
        """Annotated key, e.g. 'Eb:major' (first key_mode segment)."""
        for ann in json.loads(self.jams.read_text())["annotations"]:
            if ann["namespace"] == "key_mode" and ann["data"]:
                return str(ann["data"][0]["value"])
        return None

    def reference(self) -> tuple[list[NoteEvent], list[tuple[int, int]]]:
        """Reference notes (sorted by onset) and their (string, fret)."""
        j = json.loads(self.jams.read_text())
        tuning = Tuning()
        rows: list[tuple[float, float, int, int, int]] = []
        k = 0
        for ann in j["annotations"]:
            if ann["namespace"] != "note_midi":
                continue
            string = 6 - k
            k += 1
            for obs in ann["data"]:
                pitch = int(round(obs["value"]))
                fret = pitch - open_pitch(tuning, string)
                rows.append((obs["time"], obs["time"] + obs["duration"], pitch, string, fret))
        rows.sort()
        notes = [NoteEvent(id=f"r{i}", onset_s=a, offset_s=b, pitch_midi=p) for i, (a, b, p, _s, _f) in enumerate(rows)]
        return notes, [(s, f) for *_x, s, f in rows]


def takes(root: str | Path, kind: str = "solo", players: list[str] | None = None) -> list[Take]:
    root = Path(root).expanduser()
    out = []
    for jp in sorted((root / "ann").glob(f"*_{kind}.jams")):
        m = re.match(r"(\d\d)_([A-Za-z]+)\d?-(\d+)-", jp.name)
        if not m or (players and m.group(1) not in players):
            continue
        audio = root / "audio" / jp.name.replace(".jams", "_mic.wav")
        if audio.exists():
            out.append(Take(jp.stem, m.group(1), m.group(2), float(m.group(3)), kind, audio, jp))
    return out

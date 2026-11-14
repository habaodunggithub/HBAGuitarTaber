"""GuitarSet (Xi et al., ISMIR 2018, CC BY 4.0): real guitar with per-string note annotations.

Download from https://zenodo.org/records/3371780 (or call ``download(root)``): ``annotation.zip`` into
<root>/ann, ``audio_mono-mic.zip`` into <root>/audio, and optionally ``audio_mono-pickup_mix.zip`` into
<root>/audio_mix (the same takes through the guitar's pickup: closer to an electric guitar, same labels).
Standard tuning throughout.

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


def takes(root: str | Path, kind: str = "solo", players: list[str] | None = None, source: str = "mic") -> list[Take]:
    """``source``: "mic" (the microphone) or "mix" (the pickup mix). Takes without that audio are skipped."""
    root = Path(root).expanduser()
    folder, suffix = ("audio", "_mic.wav") if source == "mic" else ("audio_mix", "_mix.wav")
    found = {p.name: p for p in (root / folder).rglob(f"*{suffix}")} if (root / folder).is_dir() else {}
    out = []
    for jp in sorted((root / "ann").glob(f"*_{kind}.jams")):
        m = re.match(r"(\d\d)_([A-Za-z]+)\d?-(\d+)-", jp.name)
        if not m or (players and m.group(1) not in players):
            continue
        audio = found.get(jp.name.replace(".jams", suffix))
        if audio is not None:
            out.append(Take(jp.stem, m.group(1), m.group(2), float(m.group(3)), kind, audio, jp))
    return out


ZENODO = "https://zenodo.org/api/records/3371780/files/{name}/content"
PARTS = {  # zip -> (folder, md5)
    "annotation.zip": ("ann", "b39b78e63d3446f2e54ddb7a54df9b10"),
    "audio_mono-mic.zip": ("audio", "275966d6610ac34999b58426beb119c3"),
    "audio_mono-pickup_mix.zip": ("audio_mix", "aecce79f425a44e2055e46f680e10f6a"),
}


def download(root: str | Path, parts: tuple[str, ...] = tuple(PARTS)) -> Path:
    """Fetch and unpack GuitarSet parts from Zenodo (md5-checked); parts already unpacked are skipped."""
    import hashlib
    import shutil
    import urllib.request
    import zipfile

    root = Path(root).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    for name in parts:
        folder, md5 = PARTS[name]
        dest = root / folder
        if dest.is_dir() and any(dest.rglob("*.*")):
            continue
        zpath = root / name
        print(f"downloading GuitarSet {name} ...", flush=True)
        with urllib.request.urlopen(ZENODO.format(name=name)) as r, open(zpath, "wb") as f:
            shutil.copyfileobj(r, f, length=1 << 22)
        h = hashlib.md5()
        with open(zpath, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 22), b""):
                h.update(chunk)
        if h.hexdigest() != md5:
            zpath.unlink()
            raise ValueError(f"{name}: checksum mismatch, download again")
        with zipfile.ZipFile(zpath) as z:
            for member in z.namelist():  # never write outside dest
                if member.startswith("/") or ".." in Path(member).parts:
                    raise ValueError(f"{name}: unsafe path {member}")
            z.extractall(dest)
        zpath.unlink()
    return root

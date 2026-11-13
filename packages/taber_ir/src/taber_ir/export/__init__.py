from __future__ import annotations

from ..models import Score
from .alphatex import score_to_alphatex
from .ascii import score_to_ascii
from .gp5 import score_to_gp5
from .midi import score_to_midi
from .musicxml import score_to_musicxml

FORMATS = {
    "ascii": ("text/plain; charset=utf-8", "txt"),
    "alphatex": ("text/plain; charset=utf-8", "alphatex"),
    "gp5": ("application/octet-stream", "gp5"),
    "midi": ("audio/midi", "mid"),
    "musicxml": ("application/vnd.recordare.musicxml+xml", "musicxml"),
}


def export(score: Score, fmt: str) -> bytes:
    if fmt == "ascii":
        return score_to_ascii(score).encode()
    if fmt == "alphatex":
        return score_to_alphatex(score).encode()
    if fmt == "gp5":
        return score_to_gp5(score)
    if fmt == "midi":
        return score_to_midi(score)
    if fmt == "musicxml":
        return score_to_musicxml(score).encode()
    raise ValueError(f"unknown export format: {fmt}")


__all__ = [
    "FORMATS",
    "export",
    "score_to_alphatex",
    "score_to_ascii",
    "score_to_gp5",
    "score_to_midi",
    "score_to_musicxml",
]

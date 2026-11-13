"""String-numbering convention and tuning helpers.

string = 1..6, string 1 is the highest-pitched string. Always go through
``open_pitch`` instead of indexing ``Tuning.open_pitches`` directly.
"""

from __future__ import annotations

from .models import Tuning

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def num_strings(tuning: Tuning) -> int:
    return len(tuning.open_pitches)


def open_pitch(tuning: Tuning, string: int) -> int:
    """MIDI pitch of the open string (ignoring capo). string is 1-based, 1 = highest."""
    n = len(tuning.open_pitches)
    if not 1 <= string <= n:
        raise ValueError(f"string must be in 1..{n}, got {string}")
    return tuning.open_pitches[string - 1]


def sounding_pitch(tuning: Tuning, string: int, fret: int) -> int:
    """MIDI pitch for a tab position; ``fret`` is relative to the capo."""
    return open_pitch(tuning, string) + tuning.capo + fret


def note_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def preset(name: str) -> Tuning:
    """A few common tunings (string 1 -> 6)."""
    table = {
        "standard": [64, 59, 55, 50, 45, 40],
        "drop_d": [64, 59, 55, 50, 45, 38],
        "half_step_down": [63, 58, 54, 49, 44, 39],  # Eb standard
        "whole_step_down": [62, 57, 53, 48, 43, 38],  # D standard
        "open_g": [62, 59, 55, 50, 43, 38],
        "dadgad": [62, 57, 55, 50, 45, 38],
    }
    key = name.lower().replace(" ", "_")
    if key not in table:
        raise KeyError(f"unknown tuning preset: {name}")
    return Tuning(name=name, open_pitches=list(table[key]))

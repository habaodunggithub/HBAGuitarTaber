"""Carry note edits through a re-assembly.

Assembly rebuilds the score from the analysis, so without this, changing the capo would undo
every note the user deleted, added or re-pitched. The previous score holds those edits:
- ``Score.deleted_note_ids``: analysis notes the user removed.
- a score note whose ``note_id`` is an analysis note but whose pitch differs: re-pitched.
- a score note whose ``note_id`` is not in the analysis (the editor gives added notes ids
  starting with ``u``): added, timed from its slot on the beat grid.
"""

from __future__ import annotations

from .models import Analysis, NoteEvent, Score
from .truth import truth_notes


def apply_edits(analysis: Analysis, previous: Score) -> Analysis:
    by_id = {n.id: n for n in analysis.notes}
    deleted = set(previous.deleted_note_ids)
    edited: dict[str, int] = {}
    added: list[NoteEvent] = []
    for tn in truth_notes(previous, analysis):
        if not tn.note_id:
            continue
        src = by_id.get(tn.note_id)
        if src is None:
            added.append(NoteEvent(id=tn.note_id, onset_s=tn.onset_s, offset_s=tn.offset_s, pitch_midi=tn.pitch_midi))
        elif tn.pitch_midi != src.pitch_midi:
            edited[tn.note_id] = tn.pitch_midi
    if not (deleted or edited or added):
        return analysis
    notes = [
        n.model_copy(update={"pitch_midi": edited[n.id], "pitch_cents": 0.0}) if n.id in edited else n
        for n in analysis.notes if n.id not in deleted
    ]
    return analysis.model_copy(update={"notes": sorted(notes + added, key=lambda n: (n.onset_s, n.pitch_midi))})

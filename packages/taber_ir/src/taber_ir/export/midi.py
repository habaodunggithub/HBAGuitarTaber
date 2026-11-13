"""Standard MIDI file exporter (mido). Bends/whammy become pitch-bend messages."""

from __future__ import annotations

import io

import mido

from ..models import Score
from .common import parse_ts, slot_units

TPB = 480
UNIT_TICKS = TPB // 24  # 20 ticks per 1/24 beat
BEND_RANGE_TONES = 2.0  # +-2 semitones... we use +-2 whole tones => see _pw
PITCHWHEEL_MAX = 8191


def _pw(whole_tones: float, range_tones: float = 2.0) -> int:
    v = max(-1.0, min(1.0, whole_tones / range_tones))
    return int(round(v * PITCHWHEEL_MAX))


def score_to_midi(score: Score, program: int = 29) -> bytes:
    mid = mido.MidiFile(type=1, ticks_per_beat=TPB)
    meta = mido.MidiTrack()
    mid.tracks.append(meta)
    meta.append(mido.MetaMessage("track_name", name=score.title, time=0))
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("track_name", name="Guitar", time=0))
    track.append(mido.Message("program_change", program=program, channel=0, time=0))
    # +-2 whole tones = +-4 semitones pitch-bend range via RPN 0
    for cc, val in ((101, 0), (100, 0), (6, 4), (38, 0), (101, 127), (100, 127)):
        track.append(mido.Message("control_change", control=cc, value=val, channel=0, time=0))

    events: list[tuple[int, int, mido.Message | mido.MetaMessage]] = []  # (tick, order, msg)
    tick = 0
    prev_ts, prev_tempo = None, None
    pending: dict[tuple[int, int], tuple[int, int, int, list]] = {}  # key -> (start, pitch, vel, techs)

    def flush(key, end_tick):
        start, pitch, vel, techs = pending.pop(key)
        events.append((start, 1, mido.Message("note_on", note=pitch, velocity=vel, channel=0)))
        length = max(end_tick - start, 1)
        bend = next((t for t in techs if t.type in ("bend", "prebend", "release", "whammy")), None)
        if bend is not None:
            amt = bend.value if bend.value is not None else (-1.0 if bend.type == "whammy" else 1.0)
            if bend.type == "bend":
                curve = [(0.0, 0.0), (0.35, amt), (1.0, amt)]
            elif bend.type == "prebend":
                curve = [(0.0, amt), (1.0, amt)]
            elif bend.type == "release":
                curve = [(0.0, amt), (0.5, amt), (1.0, 0.0)]
            else:  # whammy dip
                curve = [(0.0, 0.0), (0.5, amt), (1.0, 0.0)]
            for frac, val in curve:
                events.append((start + int(frac * length), 0, mido.Message("pitchwheel", pitch=_pw(val), channel=0)))
            events.append((end_tick, 2, mido.Message("pitchwheel", pitch=0, channel=0)))
        events.append((end_tick, 0, mido.Message("note_off", note=pitch, velocity=0, channel=0)))

    for m in score.measures:
        if m.time_signature != prev_ts:
            n, d = parse_ts(m.time_signature)
            events.append((tick, -2, mido.MetaMessage("time_signature", numerator=n, denominator=d)))
            prev_ts = m.time_signature
        if prev_tempo is None or abs(m.tempo_bpm - prev_tempo) >= 1:
            events.append((tick, -3, mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(m.tempo_bpm))))
            prev_tempo = m.tempo_bpm
        for slot in m.slots:
            length = slot_units(slot) * UNIT_TICKS
            live = set()
            for n in slot.notes:
                key = (n.string, n.pitch_midi)
                live.add(key)
                if n.tie_from_prev and key in pending:
                    continue
                if key in pending:
                    flush(key, tick)
                pending[key] = (tick, n.pitch_midi, 96, list(n.techniques))
            for key in list(pending):
                if key not in live:
                    flush(key, tick)
            tick += length
    for key in list(pending):
        flush(key, tick)

    events.sort(key=lambda e: (e[0], e[1]))
    last = 0
    for t, _o, msg in events:
        target = meta if msg.is_meta and msg.type in ("set_tempo", "time_signature") else track
        # keep each track's delta times independent
        msg = msg.copy(time=0)
        target.append(msg)
        msg.time = t - getattr(target, "_last", 0)
        target._last = t  # type: ignore[attr-defined]
        last = max(last, t)
    for tr in (meta, track):
        tr.append(mido.MetaMessage("end_of_track", time=max(last - getattr(tr, "_last", 0), 0)))
    buf = io.BytesIO()
    mid.save(file=buf)
    return buf.getvalue()

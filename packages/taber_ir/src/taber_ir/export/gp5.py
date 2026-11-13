"""Guitar Pro 5 exporter (PyGuitarPro).

Semantics matched to alphaTab/GP: hammer/slide flags live on the origin note; bend
point values are in quarter tones (4 = one whole tone), positions 0..12.
"""

from __future__ import annotations

import io
import statistics

import guitarpro as gp

from ..models import Score, ScoreNote
from ..tuning import num_strings, open_pitch
from .common import Origin, compute_origins, parse_ts, quarter_tones, tech

MAX_POS = gp.BendEffect.maxPosition  # 12


def _duration(slot) -> gp.Duration:
    value = int(slot.duration.split("/")[1])
    tup = gp.Tuplet(slot.tuplet[0], slot.tuplet[1]) if slot.tuplet else gp.Tuplet()
    return gp.Duration(value=value, isDotted=slot.dotted, tuplet=tup)


def _apply_effects(gnote: gp.Note, sn: ScoreNote, origin: Origin | None) -> None:
    e = gnote.effect
    if origin:
        if origin.hammer:
            e.hammer = True
        if origin.slide == "legato":
            e.slides = [gp.SlideType.legatoSlideTo]
        elif origin.slide == "shift":
            e.slides = [gp.SlideType.shiftSlideTo]
    for t in sn.techniques:
        q = quarter_tones(t.value)
        if t.type == "bend":
            e.bend = gp.BendEffect(
                type=gp.BendType.bend,
                value=q,
                points=[gp.BendPoint(0, 0), gp.BendPoint(4, q), gp.BendPoint(MAX_POS, q)],
            )
        elif t.type == "prebend":
            e.bend = gp.BendEffect(
                type=gp.BendType.prebend,
                value=q,
                points=[gp.BendPoint(0, q), gp.BendPoint(MAX_POS, q)],
            )
        elif t.type == "release":
            e.bend = gp.BendEffect(
                type=gp.BendType.bendRelease,
                value=q,
                points=[gp.BendPoint(0, q), gp.BendPoint(6, q), gp.BendPoint(MAX_POS, 0)],
            )
        elif t.type == "vibrato":
            e.vibrato = True
        elif t.type == "palm_mute":
            e.palmMute = True
        elif t.type == "let_ring":
            e.letRing = True
        elif t.type == "harmonic_natural":
            e.harmonic = gp.NaturalHarmonic()
        elif t.type == "harmonic_pinch":
            e.harmonic = gp.PinchHarmonic()
        elif t.type == "slide_in":
            e.slides = [gp.SlideType.intoFromBelow]
        elif t.type == "slide_out":
            e.slides = [gp.SlideType.outUpwards if (t.value or 1) >= 0 else gp.SlideType.outDownwards]
    if tech(sn, "dead_note"):
        gnote.type = gp.NoteType.dead


def score_to_gp5(score: Score) -> bytes:
    tuning = score.assembly_params.tuning
    origins = compute_origins(score)

    song = gp.Song(title=score.title)
    song.tempo = round(statistics.median([m.tempo_bpm for m in score.measures])) if score.measures else 120
    track = song.tracks[0]
    track.name = "Guitar"
    track.fretCount = max(24, score.assembly_params.max_fret)
    track.offset = tuning.capo
    track.strings = [
        gp.GuitarString(s, open_pitch(tuning, s)) for s in range(1, num_strings(tuning) + 1)
    ]
    track.channel.instrument = 29  # overdriven guitar
    song.measureHeaders = []
    track.measures = []

    start = gp.Duration.quarterTime
    for m in score.measures:
        n, d = parse_ts(m.time_signature)
        header = gp.MeasureHeader(
            number=m.index + 1,
            start=start,
            timeSignature=gp.TimeSignature(numerator=n, denominator=gp.Duration(value=d)),
        )
        song.measureHeaders.append(header)
        measure = gp.Measure(track, header)
        track.measures.append(measure)
        voice = measure.voices[0]
        voice.beats = []
        pos = start
        for si, slot in enumerate(m.slots):
            dur = _duration(slot)
            beat = gp.Beat(voice, duration=dur, start=pos)
            if not slot.notes:
                beat.status = gp.BeatStatus.rest
            else:
                beat.status = gp.BeatStatus.normal
                for ni, sn in enumerate(slot.notes):
                    gn = gp.Note(
                        beat,
                        value=sn.fret,
                        string=sn.string,
                        type=gp.NoteType.tie if sn.tie_from_prev else gp.NoteType.normal,
                    )
                    if not sn.tie_from_prev:
                        _apply_effects(gn, sn, origins.get((m.index, si, ni)))
                    beat.notes.append(gn)
                w = next((tech(x, "whammy") for x in slot.notes if tech(x, "whammy")), None)
                if w is not None:
                    q = quarter_tones(w.value if w.value is not None else -1.0)
                    beat.effect.tremoloBar = gp.BendEffect(
                        type=gp.BendType.dip,
                        value=q,
                        points=[gp.BendPoint(0, 0), gp.BendPoint(6, q), gp.BendPoint(MAX_POS, 0)],
                    )
            voice.beats.append(beat)
            pos += dur.time
        start += header.length

    buf = io.BytesIO()
    gp.write(song, buf, version=(5, 1, 0))
    return buf.getvalue()

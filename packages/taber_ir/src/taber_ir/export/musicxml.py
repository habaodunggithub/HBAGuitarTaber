"""MusicXML 4.0 (score-partwise) exporter with TAB technical notation."""

from __future__ import annotations

from xml.etree import ElementTree as ET

from ..models import Score
from ..tuning import num_strings, open_pitch
from .common import compute_origins, parse_ts, slot_units, tech

DIVISIONS = 24  # per quarter note == our time unit
STEPS = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0), ("F", 1),
         ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0)]
TYPE = {"1/1": "whole", "1/2": "half", "1/4": "quarter", "1/8": "eighth", "1/16": "16th", "1/32": "32nd"}


def _pitch(parent: ET.Element, midi: int, tag: str = "pitch", names=("step", "alter", "octave")) -> None:
    step, alter = STEPS[midi % 12]
    p = ET.SubElement(parent, tag)
    ET.SubElement(p, names[0]).text = step
    if alter:
        ET.SubElement(p, names[1]).text = str(alter)
    ET.SubElement(p, names[2]).text = str(midi // 12 - 1)


def score_to_musicxml(score: Score) -> str:
    tuning = score.assembly_params.tuning
    origins = compute_origins(score)
    root = ET.Element("score-partwise", version="4.0")
    work = ET.SubElement(root, "work")
    ET.SubElement(work, "work-title").text = score.title
    plist = ET.SubElement(root, "part-list")
    sp = ET.SubElement(plist, "score-part", id="P1")
    ET.SubElement(sp, "part-name").text = "Guitar"
    part = ET.SubElement(root, "part", id="P1")

    prev_ts = None
    for m in score.measures:
        me = ET.SubElement(part, "measure", number=str(m.index + 1))
        if m.index == 0 or m.time_signature != prev_ts:
            attr = ET.SubElement(me, "attributes")
            if m.index == 0:
                ET.SubElement(attr, "divisions").text = str(DIVISIONS)
            n, d = parse_ts(m.time_signature)
            t = ET.SubElement(attr, "time")
            ET.SubElement(t, "beats").text = str(n)
            ET.SubElement(t, "beat-type").text = str(d)
            if m.index == 0:
                clef = ET.SubElement(attr, "clef")
                ET.SubElement(clef, "sign").text = "TAB"
                ET.SubElement(clef, "line").text = "5"
                sd = ET.SubElement(attr, "staff-details")
                ET.SubElement(sd, "staff-lines").text = str(num_strings(tuning))
                for line in range(1, num_strings(tuning) + 1):
                    st = ET.SubElement(sd, "staff-tuning", line=str(line))
                    # MusicXML lines count from the bottom: line 1 = lowest string
                    midi = open_pitch(tuning, num_strings(tuning) + 1 - line)
                    step, alter = STEPS[midi % 12]
                    ET.SubElement(st, "tuning-step").text = step
                    if alter:
                        ET.SubElement(st, "tuning-alter").text = str(alter)
                    ET.SubElement(st, "tuning-octave").text = str(midi // 12 - 1)
                if tuning.capo:
                    ET.SubElement(sd, "capo").text = str(tuning.capo)
            prev_ts = m.time_signature
            if m.index == 0:
                d_ = ET.SubElement(me, "direction", placement="above")
                dt = ET.SubElement(d_, "direction-type")
                met = ET.SubElement(dt, "metronome")
                ET.SubElement(met, "beat-unit").text = "quarter"
                ET.SubElement(met, "per-minute").text = f"{m.tempo_bpm:g}"
                ET.SubElement(d_, "sound", tempo=f"{m.tempo_bpm:g}")

        for si, slot in enumerate(m.slots):
            dur = slot_units(slot)
            if not slot.notes:
                ne = ET.SubElement(me, "note")
                ET.SubElement(ne, "rest")
                _fill_common(ne, slot, dur)
                continue
            for ni, sn in enumerate(slot.notes):
                ne = ET.SubElement(me, "note")
                if ni > 0:
                    ET.SubElement(ne, "chord")
                _pitch(ne, sn.pitch_midi)
                _fill_common(ne, slot, dur)
                if sn.tie_from_prev:
                    ET.SubElement(ne, "tie", type="stop")
                nxt = _next_is_tied(score, m.index, si, sn.string)
                if nxt:
                    ET.SubElement(ne, "tie", type="start")
                nt = ET.SubElement(ne, "notations")
                if sn.tie_from_prev:
                    ET.SubElement(nt, "tied", type="stop")
                if nxt:
                    ET.SubElement(nt, "tied", type="start")
                te = ET.SubElement(nt, "technical")
                ET.SubElement(te, "string").text = str(sn.string)
                ET.SubElement(te, "fret").text = str(sn.fret)
                o = origins.get((m.index, si, ni))
                if o and o.hammer:
                    ET.SubElement(te, "pull-off" if "pull_off" in o.extra else "hammer-on", type="start").text = "H" if "hammer_on" in o.extra else "P"
                if tech(sn, "bend") or tech(sn, "prebend"):
                    b = ET.SubElement(te, "bend")
                    ET.SubElement(b, "bend-alter").text = str(round((tech(sn, "bend") or tech(sn, "prebend")).value * 2 if (tech(sn, "bend") or tech(sn, "prebend")).value else 2))
                if tech(sn, "harmonic_natural"):
                    h = ET.SubElement(te, "harmonic")
                    ET.SubElement(h, "natural")
                if tech(sn, "vibrato"):
                    orn = ET.SubElement(nt, "ornaments")
                    ET.SubElement(orn, "wavy-line", type="start")
    ET.indent(root)
    body = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n"


def _fill_common(ne: ET.Element, slot, dur: int) -> None:
    ET.SubElement(ne, "duration").text = str(dur)
    ET.SubElement(ne, "voice").text = "1"
    ET.SubElement(ne, "type").text = TYPE[slot.duration]
    if slot.dotted:
        ET.SubElement(ne, "dot")
    if slot.tuplet:
        tm = ET.SubElement(ne, "time-modification")
        ET.SubElement(tm, "actual-notes").text = str(slot.tuplet[0])
        ET.SubElement(tm, "normal-notes").text = str(slot.tuplet[1])


def _next_is_tied(score: Score, mi: int, si: int, string: int) -> bool:
    m = score.measures[mi]
    if si + 1 < len(m.slots):
        nxt = m.slots[si + 1]
    elif mi + 1 < len(score.measures) and score.measures[mi + 1].slots:
        nxt = score.measures[mi + 1].slots[0]
    else:
        return False
    return any(n.tie_from_prev and n.string == string for n in nxt.notes)

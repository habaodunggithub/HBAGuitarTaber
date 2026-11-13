from taber_ir.models import NoteEvent
from taber_ml.audio.key import detect_key, parse_key
from taber_ml.audio.segment import _round_pitch


def _notes(pitches, dur=0.25):
    return [
        NoteEvent(id=f"n{i}", onset_s=i * dur, offset_s=(i + 1) * dur, pitch_midi=p, velocity=0.8, confidence=0.9)
        for i, p in enumerate(pitches)
    ]


def test_detects_a_minor_pentatonic_lick():
    # A minor pentatonic box with the tonic stressed
    lick = [57, 60, 62, 64, 67, 69, 67, 64, 62, 60, 57, 57, 64, 69, 72, 69, 67, 64, 57, 57]
    k = detect_key(_notes(lick))
    assert k is not None
    assert k.scale == parse_key("A:minor").scale  # A minor or C major: same pitch set


def test_detects_e_major_scale():
    up = [64, 66, 68, 69, 71, 73, 75, 76]
    k = detect_key(_notes(up + up[::-1] + [64, 71, 64, 68, 64]))
    assert k is not None and k.tonic == 4 and k.mode == "major"


def test_too_few_notes_gives_no_key():
    assert detect_key(_notes([60, 62, 64])) is None


def test_parse_key_enharmonics():
    assert parse_key("Gb:major").tonic == parse_key("F#:major").tonic == 6
    assert parse_key("Eb:minor").scale == frozenset({3, 5, 6, 8, 10, 11, 1})


def test_round_pitch_scale_snap():
    c_major = parse_key("C:major").scale
    assert _round_pitch(61.45, None, 0.3) == 61  # no scale: plain rounding
    assert _round_pitch(61.45, c_major, 0.3) == 62  # C# out of scale, D in scale
    assert _round_pitch(61.1, c_major, 0.3) == 61  # clearly C#: chromatic notes survive
    assert _round_pitch(60.4, c_major, 0.3) == 60  # both neighbours... C in, C# out: stays C

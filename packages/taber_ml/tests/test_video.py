"""Video stage. A synthetic video (perspective fretboard with texture, camera shake, a red 'fingertip' on the
true fret) plus a fake hand tracker that finds the red dot checks everything except the MediaPipe model:
frame timing, neck tracking, projection, scoring and the effect on string/fret choice."""
from __future__ import annotations

import shutil
import subprocess

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from taber_ir import AssemblyParams, assemble, iter_score_notes  # noqa: E402
from taber_ir.fusion.video import fret_u, string_v, u_to_fret, video_scores  # noqa: E402
from taber_ir.models import Analysis, AnalysisOptions, NoteEvent, VideoCalibration  # noqa: E402
from taber_ir.testing import TabNote, analysis_from_tab  # noqa: E402
from taber_ml.video.geometry import calibration_homography, fingertips_on_board, to_board  # noqa: E402
from taber_ml.video.stage import analyze_video  # noqa: E402

W, H, FPS = 960, 540, 30
# fretboard corners in the image for wires 0 (nut) and 15, strings 6 (bottom) and 1 (top), with perspective
NUT6, NUT1, F15_1, F15_6 = (880, 330), (880, 250), (120, 215), (120, 365)
TRUE_H = None


def board_to_img(u: float, v: float) -> tuple[float, float]:
    """Inverse of a projective map defined by the 4 corners (u in [0, fret_u(15)], v in [0, 1])."""
    src = np.float32([[0, 0], [0, 1], [fret_u(15), 1], [fret_u(15), 0]])
    dst = np.float32([NUT6, NUT1, F15_1, F15_6])
    M = cv2.getPerspectiveTransform(src, dst)
    p = M @ np.array([u, v, 1.0])
    return float(p[0] / p[2]), float(p[1] / p[2])


def background(rng) -> np.ndarray:
    img = (rng.random((H, W, 3)) * 40 + 30).astype(np.uint8)
    poly = np.int32([NUT6, NUT1, F15_1, F15_6])
    wood = (rng.random((H, W, 3)) * 90 + 60).astype(np.uint8)
    wood = cv2.GaussianBlur(wood, (3, 3), 0)
    mask = np.zeros((H, W), np.uint8)
    cv2.fillPoly(mask, [poly], 255)
    img[mask > 0] = wood[mask > 0]
    for n in range(0, 16):
        a, b = board_to_img(fret_u(n), -0.05), board_to_img(fret_u(n), 1.05)
        cv2.line(img, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), (200, 200, 200), 2)
    for s in range(1, 7):
        v = string_v(s)
        a, b = board_to_img(0, v), board_to_img(fret_u(15), v)
        cv2.line(img, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), (230, 230, 230), 1)
    for n in (3, 5, 7, 9, 12):  # inlays
        c = board_to_img(fret_u(n) - (fret_u(n) - fret_u(n - 1)) / 2, 0.5)
        cv2.circle(img, (int(c[0]), int(c[1])), 5, (40, 40, 40), -1)
    return img


def make_video(path, notes: list[NoteEvent], positions: list[tuple[int, int]], seconds: float, shake: float = 3.0):
    rng = np.random.default_rng(0)
    base = background(rng)
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for i in range(int(seconds * FPS)):
        t = i / FPS
        frame = base.copy()
        for n, (s, f) in zip(notes, positions):
            if n.onset_s - 0.01 <= t < n.offset_s and f > 0:
                u = fret_u(f) - 0.3 * (fret_u(f) - fret_u(f - 1))  # just behind the wire
                x, y = board_to_img(u, string_v(s))
                cv2.circle(frame, (int(x), int(y)), 7, (0, 0, 255), -1)  # red (BGR)
        dx, dy = shake * np.sin(t * 2.1), shake * np.cos(t * 1.7)  # the player moves the guitar a little
        frame = cv2.warpAffine(frame, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H), borderMode=cv2.BORDER_REPLICATE)
        vw.write(frame)
    vw.release()


class RedDotHand:
    """Fake hand tracker: the red dot is the index fingertip, other fingertips are far away."""

    name = "red-dot"

    def hands(self, rgb: np.ndarray) -> list[np.ndarray]:
        mask = (rgb[:, :, 0] > 180) & (rgb[:, :, 1] < 80) & (rgb[:, :, 2] < 80)
        if mask.sum() < 10:
            return []
        ys, xs = np.nonzero(mask)
        lm = np.full((21, 2), -5000.0, np.float32)
        lm[8] = [xs.mean(), ys.mean()]
        return [lm]


def calibration(fa=3, fb=12) -> VideoCalibration:
    pts = [board_to_img(fret_u(fa), 0), board_to_img(fret_u(fa), 1), board_to_img(fret_u(fb), 1), board_to_img(fret_u(fb), 0)]
    return VideoCalibration(t_s=0.0, points=[(x / W, y / H) for x, y in pts], fret_a=fa, fret_b=fb)


# a lick high on the neck: prior-only fingering prefers lower positions on thinner strings
HIGH_LICK = [(4, 14), (4, 12), (3, 14), (3, 12), (4, 14), (4, 12), (5, 14), (5, 12)]


def lick():
    tab = [TabNote(s, f, i * 0.5, 0.5) for i, (s, f) in enumerate(HIGH_LICK)]
    return analysis_from_tab(tab, bpm=100), sorted(tab, key=lambda x: (x.start, x.string))


# ───────────── pure geometry ─────────────
def test_fret_law_roundtrip():
    for n in (0, 1, 5, 12, 19):
        assert abs(u_to_fret(fret_u(n)) - n) < 1e-9
    assert abs(fret_u(12) - 0.5) < 1e-12  # the 12th fret halves the string


def test_calibration_homography_maps_clicked_corners():
    cal = calibration(5, 12)
    pts = np.float32([[x * W, y * H] for x, y in cal.points])
    Hm = calibration_homography(pts, 5, 12)
    uv = to_board(Hm, pts)
    assert np.allclose(uv, [[fret_u(5), 0], [fret_u(5), 1], [fret_u(12), 1], [fret_u(12), 0]], atol=1e-4)
    # a point between the clicked frets maps to the right fret / string
    x, y = board_to_img(fret_u(9) - 0.01, string_v(3))
    u, v = to_board(Hm, np.float32([[x, y]]))[0]
    assert 8.5 < u_to_fret(u) < 9.0 and abs(v - string_v(3)) < 0.02
    with pytest.raises(ValueError):
        calibration_homography(pts, 7, 5)


def test_fingertips_outside_the_board_are_ignored():
    cal = calibration()
    Hm = calibration_homography(np.float32([[x * W, y * H] for x, y in cal.points]), cal.fret_a, cal.fret_b)
    lm = np.full((21, 2), -5000.0, np.float32)
    lm[8] = board_to_img(fret_u(7) - 0.005, string_v(2))
    lm[12] = (5, 5)  # top-left corner of the image: nowhere near the neck
    tips = fingertips_on_board(Hm, lm)
    assert [t.finger for t in tips] == [1]


def test_scores_prefer_the_seen_position_and_respect_capo():
    note = NoteEvent(id="n", onset_s=0, offset_s=1, pitch_midi=64,
                     video_evidence={"frames": [[[fret_u(9) - 0.006, string_v(3), 2]]]})  # finger 2 on string 3, fret 9
    cands = [(1, 0), (2, 5), (3, 9), (4, 14)]
    sc = video_scores(note, cands)
    assert max(sc, key=lambda c: sc[c][0]) == (3, 9) and sc[(3, 9)][1] > 0.8 and sc[(3, 9)][2] == 2
    # with capo 2 the same physical spot is tab fret 7 on string 3
    sc2 = video_scores(note, [(2, 3), (3, 7), (4, 12)], capo=2)
    assert max(sc2, key=lambda c: sc2[c][0]) == (3, 7)
    assert video_scores(NoteEvent(id="x", onset_s=0, offset_s=1, pitch_midi=64), cands) == {}


def test_far_fingertip_gives_no_strength():
    note = NoteEvent(id="n", onset_s=0, offset_s=1, pitch_midi=64, video_evidence={"frames": [[[fret_u(2), string_v(6), 1]]]})
    sc = video_scores(note, [(2, 5), (3, 9)])
    assert all(v[1] < 0.05 for v in sc.values())  # nothing near any candidate: no influence


# ───────────── fusion ─────────────
def test_video_evidence_changes_the_fingering():
    an, truth = lick()
    params = AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=100)
    blind = {n.note_id: (n.string, n.fret) for _, _, n in iter_score_notes(assemble(an, params)) if not n.tie_from_prev}
    for n, t in zip(an.notes, truth):
        u = fret_u(t.fret) - 0.3 * (fret_u(t.fret) - fret_u(t.fret - 1))
        n.video_evidence = {"frames": [[[u, string_v(t.string), 1]]]}
    seen = {n.note_id: (n.string, n.fret) for _, _, n in iter_score_notes(assemble(an, params)) if not n.tie_from_prev}
    want = {n.id: (t.string, t.fret) for n, t in zip(an.notes, truth)}
    assert sum(blind[k] == v for k, v in want.items()) < len(want)  # the prior alone gets some wrong
    assert seen == want  # the video fixes all of them


def test_video_weight_zero_means_audio_only():
    an, truth = lick()
    for n, t in zip(an.notes, truth):
        n.video_evidence = {"frames": [[[fret_u(t.fret) - 0.003, string_v(t.string), 1]]]}
    p0 = AssemblyParams(fingering_weights={"w_video": 0.0})
    plain = Analysis.model_validate(an.model_dump())
    for n in plain.notes:
        n.video_evidence = None
    a = [(n.string, n.fret) for _, _, n in iter_score_notes(assemble(an, p0))]
    b = [(n.string, n.fret) for _, _, n in iter_score_notes(assemble(plain, p0))]
    assert a == b


# ───────────── video stage on a real (synthetic) video file ─────────────
def test_analyze_video_end_to_end(tmp_path):
    an, truth = lick()
    path = tmp_path / "take.mp4"
    make_video(path, an.notes, [(t.string, t.fret) for t in truth], seconds=an.notes[-1].offset_s + 0.5)
    rep = analyze_video(str(path), an.notes, calibration(), RedDotHand())
    assert rep.used and rep.notes_with_evidence == len(an.notes)
    assert rep.hands_ratio > 0.9 and rep.tracked_ratio > 0.8  # the camera shake is tracked
    score = assemble(an, AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=100))
    got = [(n.string, n.fret) for _, _, n in iter_score_notes(score) if not n.tie_from_prev]
    assert got == [(t.string, t.fret) for t in truth]
    assert all(n.finger == "1" for _, _, n in iter_score_notes(score) if not n.tie_from_prev)  # the dot is finger 1


def test_wrong_calibration_degrades_gracefully(tmp_path):
    an, truth = lick()
    path = tmp_path / "take.mp4"
    make_video(path, an.notes, [(t.string, t.fret) for t in truth], seconds=an.notes[-1].offset_s + 0.5)
    bad = VideoCalibration(t_s=0, points=[(0.01, 0.01), (0.02, 0.01), (0.02, 0.02), (0.01, 0.02)], fret_a=1, fret_b=2)
    rep = analyze_video(str(path), an.notes, bad, RedDotHand())
    score = assemble(an, AssemblyParams())
    assert [n.pitch_midi for _, _, n in iter_score_notes(score) if not n.tie_from_prev] == [n.pitch_midi for n in an.notes]
    assert rep.frames > 0  # it ran; the evidence is weak or absent, never a crash


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg needed to mux audio into the video")
def test_pipeline_with_a_video_take(tmp_path, monkeypatch):
    """Video with its own audio track, uploaded as the only input: audio -> notes, video -> strings."""
    import soundfile as sf
    from taber_ml.io.local_dir import LocalDirIO
    from taber_ml.models import ModelRegistry
    from taber_ml.pipeline import JobSpec, run_analysis
    from taber_ml.synth import render

    an, truth = lick()
    silent = tmp_path / "silent.mp4"
    make_video(silent, an.notes, [(t.string, t.fret) for t in truth], seconds=an.notes[-1].offset_s + 0.8)
    wav = tmp_path / "a.wav"
    sf.write(wav, render(an.notes, tone="distortion_light"), 44100)
    take = tmp_path / "take.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-shortest", str(take)], check=True)

    monkeypatch.setattr(ModelRegistry, "get_hand_tracker", lambda self: RedDotHand())
    opts = AnalysisOptions(use_video=True, video_calibration=calibration(), separate_source="off")
    stages: list[str] = []
    spec = JobSpec(options=opts, inputs={"wet": str(take)}, tracker="pyin")
    result = run_analysis(spec, LocalDirIO(spec.inputs, on_progress=lambda s, *_: stages.append(s)))
    assert "video" in stages and result.quality.video["used"] is True
    score = assemble(result, AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=100))
    got = [(n.string, n.fret) for _, _, n in iter_score_notes(score) if not n.tie_from_prev]
    assert got == [(t.string, t.fret) for t in truth]


def test_mediapipe_runs_on_a_frame_without_hands():
    pytest.importorskip("mediapipe")
    from taber_ml.video.hands import MediaPipeHands

    try:
        tracker = MediaPipeHands()
    except OSError as e:  # model download needs the internet once
        pytest.skip(f"hand landmarker model unavailable: {e}")
    rgb = cv2.cvtColor(background(np.random.default_rng(1)), cv2.COLOR_BGR2RGB)
    assert tracker.hands(rgb) == []


def test_video_without_calibration_is_reported(tmp_path):
    import soundfile as sf
    from taber_ml.io.local_dir import LocalDirIO
    from taber_ml.pipeline import JobSpec, run_analysis
    from taber_ml.synth import render

    an, _ = lick()
    wav = tmp_path / "a.wav"
    sf.write(wav, render(an.notes), 44100)
    spec = JobSpec(options=AnalysisOptions(use_video=True, separate_source="off"), inputs={"wet": str(wav)}, tracker="pyin")
    result = run_analysis(spec, LocalDirIO(spec.inputs))
    assert result.quality.video == {"used": False, "reason": "The fretboard has not been calibrated on the video"}

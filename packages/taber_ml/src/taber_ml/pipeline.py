"""Analysis phase: run_analysis(spec, io, models) -> Analysis (docs §8.5, ADR-009).

The core knows nothing about where it runs. ``JobIO`` adapters supply inputs, progress,
cancellation and result delivery (local directory, HTTP pull worker, serverless).
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np
from taber_ir.models import SCHEMA_VERSION, Analysis, AnalysisOptions, F0Track, QualityReport

from .audio.beats import get_beat_tracker
from .audio.f0 import F0Result, get_tracker
from .audio.ingest import load_audio
from .audio.key import detect_key
from .audio.segment import F0FirstSegmenter, Segmentation
from .audio.separation import separate_file
from .models import ModelRegistry

PIPELINE_VERSION = "0.2.0"  # 0.2: Basic Pitch onsets + string classifier
STAGES = ["ingest", "separation", "beats", "f0", "segment", "video", "quality"]


class Canceled(Exception):
    pass


class JobIO(Protocol):
    def fetch_input(self, asset_id: str) -> Path: ...
    def report(self, stage: str, progress: float, message: str = "") -> None: ...
    def is_canceled(self) -> bool: ...
    def submit(self, analysis: Analysis) -> None: ...


@dataclass
class JobSpec:
    options: AnalysisOptions = field(default_factory=AnalysisOptions)
    inputs: dict[str, str] = field(default_factory=dict)  # role ("wet"|"di") -> asset id
    tempo_hint_bpm: float | None = None
    tracker: str = "auto"
    beat_tracker: str = "auto"


def _f0_preview(f0: F0Result, step_s: float = 0.02) -> F0Track:
    """Down-sampled pitch contour for the UI (nearest frame, None where unvoiced)."""
    if not len(f0):
        return F0Track(hop_s=step_s, start_s=0.0, midi=[])
    grid = np.arange(int(f0.times[-1] / step_s) + 1) * step_s
    idx = np.clip(np.searchsorted(f0.times, grid), 0, len(f0) - 1)
    vals = [None if np.isnan(f0.midi[k]) else round(float(f0.midi[k]), 2) for k in idx]
    return F0Track(hop_s=step_s, start_s=0.0, midi=vals)


def run_analysis(spec: JobSpec, io: JobIO, models: ModelRegistry | None = None) -> Analysis:
    models = models or ModelRegistry()
    opts = spec.options
    timings: dict[str, float] = {}
    warnings: list[str] = []

    def stage(name: str, i: int, msg: str = "") -> float:
        if io.is_canceled():
            raise Canceled()
        io.report(name, i / len(STAGES), msg)  # the API's reply may announce a cancel
        if io.is_canceled():
            raise Canceled()
        return time.perf_counter()

    # ── 0. ingest ──
    t0 = stage("ingest", 0, "Reading and normalizing audio")
    wet_path = io.fetch_input(spec.inputs["wet"]) if "wet" in spec.inputs else None
    di_path = io.fetch_input(spec.inputs["di"]) if "di" in spec.inputs else None
    primary = di_path or wet_path
    if primary is None:
        raise ValueError("no audio input (need a 'wet' and/or 'di' role)")
    seg_audio = load_audio(primary)
    beat_audio = load_audio(wet_path) if (wet_path and di_path) else seg_audio
    if seg_audio.clipping:
        warnings.append("The audio is clipped (overloaded); accuracy may suffer.")
    timings["ingest"] = time.perf_counter() - t0

    # ── 1. source separation: notes are read from the guitar stem, beats still from the full mix ──
    t0 = stage("separation", 1, "Separating the guitar from the backing track")
    separation: dict | None = None
    if opts.separate_source == "off":
        separation = {"used": False, "stem": "original", "reason": "Backing-track separation is off"}
    elif di_path is not None:
        separation = {"used": False, "stem": "original", "reason": "A clean DI track is available, no separation needed"}
    else:
        try:
            sep = models.get_separator()
            stem_audio, info = separate_file(primary, sep, force=opts.separate_source == "on")
            separation = asdict(info)
            if info.warning:
                warnings.append(info.warning)
            if stem_audio is not None:
                seg_audio = stem_audio  # beat_audio keeps the original mix (drums help beat tracking)
            if models.small_gpu:
                models.release("separator")  # leave the 6 GB laptop GPU to the pitch tracker
        except ImportError:
            separation = {"used": False, "stem": "original", "reason": "demucs is not installed (just setup)"}
            if opts.separate_source == "on":
                warnings.append("Demucs is not installed, so the backing track was not removed. Run just setup to install it.")
    timings["separation"] = time.perf_counter() - t0

    # ── 2. beats ──
    t0 = stage("beats", 2, "Detecting the beat")
    beat_tracker = models.get(f"beats:{spec.beat_tracker}", lambda: get_beat_tracker(spec.beat_tracker))
    grid = beat_tracker.track(beat_audio, spec.tempo_hint_bpm)
    if models.small_gpu:
        models.release(f"beats:{spec.beat_tracker}")
    if not grid.beats_s:
        warnings.append("No steady beat found; enter a tempo or tap the beat.")
    timings["beats"] = time.perf_counter() - t0

    # ── 3a. f0 ──
    t0 = stage("f0", 3, "Tracking pitch")
    tracker = models.get_tracker(spec.tracker) if hasattr(models, "get_tracker") else get_tracker(spec.tracker)
    f0 = tracker.track(seg_audio.y, seg_audio.sr)
    timings["f0"] = time.perf_counter() - t0

    # ── 3b/4. segmentation + techniques: the onset model (Basic Pitch) decides where notes start ──
    t0 = stage("segment", 4, "Finding notes and techniques")
    posteriors = None
    if opts.segmenter != "f0_first":
        try:
            posteriors = models.get_onset_model().run(seg_audio.y, seg_audio.sr)
        except ImportError:
            if opts.segmenter == "basic_pitch":
                warnings.append("onnxruntime is not installed, so the onset model was not used. Run just setup to install it.")
    segmenter = F0FirstSegmenter(onset_model=posteriors is not None)
    seg: Segmentation = segmenter.segment(seg_audio, f0, detect_techniques=opts.detect_techniques, posteriors=posteriors)
    # key from the first pass; a second pass with the scale prior runs only if SegmentParams enables it
    key = detect_key(seg.notes)
    key_report: dict | None = None
    if key is not None:
        prior = segmenter.p.scale_snap > 0 or segmenter.p.scale_prune_conf > 0
        if prior:
            seg = segmenter.segment(seg_audio, f0, detect_techniques=opts.detect_techniques, scale=key.scale, posteriors=posteriors)
        key_report = {"name": key.name, "tonic": key.tonic, "mode": key.mode, "margin": round(key.margin, 3), "scale_prior": prior}
    # which string: a timbre classifier gives P(string) per note, the assembly's Viterbi weighs it in
    string_model: str | None = None
    if opts.string_model != "off" and seg.notes:
        from . import strings

        if strings.available():
            clf = models.get_string_classifier()
            probs = clf.predict(seg_audio.y, seg_audio.sr, [n.onset_s for n in seg.notes], [n.pitch_midi for n in seg.notes])
            for n, pr in zip(seg.notes, probs):
                n.string_probs = [round(float(x), 4) for x in pr]
            string_model = f"{clf.name}@{clf.version}"
        elif opts.string_model == "on":
            warnings.append("The string classifier needs torch (just setup); strings were chosen from hand movement only.")
    timings["segment"] = time.perf_counter() - t0

    # ── quality ──
    # ── 5. video: fingertips on the fretboard around each onset (only with a calibration) ──
    t0 = stage("video", 5, "Reading the fretting hand from video")
    video_report: dict | None = None
    if opts.use_video:
        vpath = io.fetch_input(spec.inputs["video"]) if "video" in spec.inputs else wet_path
        if opts.video_calibration is None:
            video_report = {"used": False, "reason": "The fretboard has not been calibrated on the video"}
        elif vpath is None:
            video_report = {"used": False, "reason": "No video"}
        else:
            try:
                from .video.stage import analyze_video

                rep_ = analyze_video(str(vpath), seg.notes, opts.video_calibration, models.get_hand_tracker())
                video_report = asdict(rep_)
                if not rep_.used:
                    warnings.append("The video did not help: " + rep_.reason + ". Check the 4 calibration points.")
                elif rep_.tracked_ratio < 0.5:
                    warnings.append("The guitar moved a lot or the light is low, so the neck was hard to track; video results are less reliable.")
            except ImportError:
                video_report = {"used": False, "reason": "mediapipe/opencv is not installed (just setup)"}
                warnings.append("Video analysis libraries are not installed. Run just setup to install them.")
            except ValueError as e:
                video_report = {"used": False, "reason": str(e)}
                warnings.append(f"Could not read the video: {e}")
    timings["video"] = time.perf_counter() - t0

    t0 = stage("quality", 6, "Checking quality")
    voiced = float(np.mean(~np.isnan(f0.midi))) if len(f0) else 0.0
    low_conf = float(np.mean([n.confidence < 0.5 for n in seg.notes])) if seg.notes else 0.0
    if not seg.notes:
        warnings.append("No notes found; check the audio file.")
    elif voiced < 0.25:
        warnings.append("Few passages have a clear pitch; the audio may be polyphonic or noisy.")
    quality = QualityReport(
        voiced_ratio=round(voiced, 3),
        low_confidence_note_ratio=round(low_conf, 3),
        clipping=seg_audio.clipping,
        polyphony_detected=False,
        separation=separation,
        video=video_report,
        key=key_report,
        warnings=warnings,
    )
    timings["quality"] = time.perf_counter() - t0

    analysis = Analysis(
        schema_version=SCHEMA_VERSION,
        ingest_offset_s=0.0,
        tuning_offset_cents=round(seg.tuning_offset_cents, 1),
        notes=seg.notes,
        beat_grid=grid,
        f0_preview=_f0_preview(f0),
        quality=quality,
        meta={
            "pipeline_version": PIPELINE_VERSION,
            "options": opts.model_dump(),
            "pitch_tracker": f0.name,
            "beat_tracker": beat_tracker.name,
            "segmenter": segmenter.name,
            "string_model": string_model,
            "device": models.device,
            "duration_s": round(seg_audio.duration_s, 2),
            "inputs": sorted(spec.inputs),
            "stages": {k: round(v, 3) for k, v in timings.items()},
        },
    )
    if io.is_canceled():
        raise Canceled()
    io.report("done", 1.0, "Xong")
    io.submit(analysis)
    return analysis

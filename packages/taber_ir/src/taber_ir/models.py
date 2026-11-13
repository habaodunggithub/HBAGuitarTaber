"""IR schema (docs/ARCHITECTURE.md §7).

Conventions used everywhere:
- string = 1..6, string 1 = highest (E4 in standard), string 6 = lowest (E2).
- all times are seconds on the timeline of the original *wet* file.
- durations are strings like "1/16" (JSON-schema friendly, no Fraction).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"

Duration = Annotated[str, Field(pattern=r"^[1-9]\d*/[1-9]\d*$")]  # "1/16"
Finger = Literal["0", "1", "2", "3", "4", "T"]  # 0 = open string, T = thumb
TechniqueType = Literal[
    "bend", "release", "prebend", "vibrato", "whammy",
    "slide_in", "slide_out", "slide_legato", "slide_shift",
    "hammer_on", "pull_off", "palm_mute",
    "harmonic_natural", "harmonic_pinch", "tap", "let_ring", "dead_note",
]

STANDARD_OPEN_PITCHES = [64, 59, 55, 50, 45, 40]  # string 1 -> 6


class Tuning(BaseModel):
    name: str = "Standard"
    # element i is string i+1. Never index directly: use taber_ir.tuning.open_pitch().
    open_pitches: list[int] = Field(default_factory=lambda: list(STANDARD_OPEN_PITCHES))
    capo: int = 0


class Technique(BaseModel):
    type: TechniqueType
    value: float | None = None  # bend 1.0 = one whole tone; whammy < 0 = dive
    curve: list[tuple[float, float]] | None = None  # (relative time 0..1, semitones)
    confidence: float = 1.0


# ───────────── Analysis phase: immutable, produced by the worker ─────────────
class VideoCalibration(BaseModel):
    """Where the fretboard is, clicked once by the user on one frame.

    points (normalised 0..1 image coords, order): (fret_a, string 6), (fret_a, string 1),
    (fret_b, string 1), (fret_b, string 6). Frets are absolute fret wires (ignoring any capo).
    """

    t_s: float = Field(ge=0)
    points: list[tuple[float, float]] = Field(min_length=4, max_length=4)
    fret_a: int = Field(ge=0, le=23)
    fret_b: int = Field(ge=1, le=24)


class AnalysisOptions(BaseModel):  # changing these requires re-running analysis
    mode: Literal["monophonic", "allow_double_stops"] = "monophonic"
    segmenter: Literal["auto", "basic_pitch", "f0_first"] = "auto"
    separate_source: Literal["auto", "on", "off"] = "auto"
    tone: Literal["clean", "distortion_light", "high_gain"] = "distortion_light"
    detect_techniques: bool = True
    use_video: bool = False
    video_calibration: VideoCalibration | None = None


class NoteEvent(BaseModel):
    id: str
    onset_s: float
    offset_s: float
    pitch_midi: int  # fretted pitch (before bend / whammy)
    pitch_cents: float = 0.0
    velocity: float = 0.8
    onset_strength: float = 1.0  # low => legato (hammer-on / pull-off)
    confidence: float = 1.0
    techniques: list[Technique] = Field(default_factory=list)
    string_probs: list[float] | None = None  # 6 values, string 1..6
    video_evidence: dict | None = None  # Phase 4


class BeatGrid(BaseModel):
    beats_s: list[float] = Field(default_factory=list)
    downbeats_s: list[float] = Field(default_factory=list)
    time_signature: str = "4/4"
    tempo_bpm: float | None = None


class F0Track(BaseModel):
    hop_s: float = 0.02
    start_s: float = 0.0
    midi: list[float | None] = Field(default_factory=list)  # None = unvoiced


class QualityReport(BaseModel):
    voiced_ratio: float = 0.0
    low_confidence_note_ratio: float = 0.0
    clipping: bool = False
    polyphony_detected: bool = False
    warnings: list[str] = Field(default_factory=list)
    # what the source-separation stage did (None: not attempted). Keys: used, stem, reason, backing_db, stems_db
    separation: dict | None = None
    # what the video stage did (None: not run). Keys: used, frames, hands_ratio, notes_with_evidence, tracked_ratio
    video: dict | None = None
    # detected key of the take (None: too few notes). Keys: name, tonic, mode, margin, scale_prior
    key: dict | None = None


class Analysis(BaseModel):
    schema_version: str = SCHEMA_VERSION
    ingest_offset_s: float = 0.0  # leading silence trimmed at Stage 0
    tuning_offset_cents: float = 0.0
    notes: list[NoteEvent] = Field(default_factory=list)
    beat_grid: BeatGrid = Field(default_factory=BeatGrid)
    f0_preview: F0Track = Field(default_factory=F0Track)
    quality: QualityReport = Field(default_factory=QualityReport)
    meta: dict = Field(default_factory=dict)  # pipeline_version, model_versions, device, options, stage timings


# ───────────── Assembly phase: produced by assemble(), edited by the user ─────────────
class AssemblyParams(BaseModel):  # changing these only needs a re-assemble
    tuning: Tuning = Field(default_factory=Tuning)
    max_fret: int = 22
    timing: Literal["auto", "grid_from_hint", "user_tapped", "free"] = "auto"
    tempo_hint_bpm: float | None = None
    time_signature: str | None = None
    user_beats_s: list[float] | None = None  # when timing == "user_tapped"
    fingering_weights: dict[str, float] = Field(default_factory=dict)


class ScoreNote(BaseModel):
    note_id: str | None = None  # NoteEvent id; None if added by the user
    pitch_midi: int
    string: int  # 1..6
    fret: int
    finger: Finger | None = None
    techniques: list[Technique] = Field(default_factory=list)
    tie_from_prev: bool = False
    locked: bool = False  # user-edited: re-assembling keeps it unchanged


class Slot(BaseModel):  # a position inside a measure (NOT a musical beat)
    duration: Duration
    dotted: bool = False
    tuplet: tuple[int, int] | None = None  # (3, 2)
    notes: list[ScoreNote] = Field(default_factory=list)  # empty = rest
    start_s: float = 0.0


class Measure(BaseModel):
    index: int
    time_signature: str = "4/4"
    tempo_bpm: float = 120.0
    slots: list[Slot] = Field(default_factory=list)


class SyncPoint(BaseModel):
    measure_index: int
    time_s: float


class Score(BaseModel):
    schema_version: str = SCHEMA_VERSION
    title: str = "Untitled"
    analysis_id: str = ""
    assembly_params: AssemblyParams = Field(default_factory=AssemblyParams)
    measures: list[Measure] = Field(default_factory=list)
    sync_points: list[SyncPoint] = Field(default_factory=list)

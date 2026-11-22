"""IR schema (docs/ARCHITECTURE.md §7).

Conventions used everywhere:
- string = 1..6, string 1 = highest (E4 in standard), string 6 = lowest (E2).
- all times are seconds on the timeline of the original *wet* file.
- durations are strings like "1/16" (JSON-schema friendly, no Fraction).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

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
GuitarBody = Literal["parallel", "electric", "acoustic", "classical"]


class VideoCalibration(BaseModel):
    """Where the fretboard is, clicked once by the user on one frame.

    The user clicks both outer strings on each fret wire of ``frets`` (2 to 5 wires, ascending; absolute
    wires, ignoring any capo), snaking: wire 1 string 6 -> string 1, wire 2 string 1 -> string 6, ...
    So with two wires A < B, points are (A, 6), (A, 1), (B, 1), (B, 6). Points are normalised 0..1 image
    coords. More wires = a least-squares fit, so one sloppy click weighs less.

    ``guitar`` sets how the neck tapers (the outer strings spread from the nut to the bridge);
    "parallel" ignores the taper (calibrations made before this existed).
    """

    t_s: float = Field(ge=0)
    points: list[tuple[float, float]] = Field(min_length=4, max_length=10)
    fret_a: int = Field(ge=0, le=23)  # first and last clicked wire
    fret_b: int = Field(ge=1, le=24)
    frets: list[int] | None = None  # every clicked wire, ascending; None = [fret_a, fret_b]
    guitar: GuitarBody = "parallel"

    @model_validator(mode="after")
    def _check_wires(self) -> VideoCalibration:
        w = self.wires
        if not 2 <= len(w) <= 5:
            raise ValueError("click 2 to 5 fret wires")
        if any(b <= a for a, b in zip(w, w[1:])) or not 0 <= w[0] or w[-1] > 24:
            raise ValueError("the fret wires must go up, between 0 and 24")
        if (w[0], w[-1]) != (self.fret_a, self.fret_b):
            raise ValueError("fret_a and fret_b must be the first and the last of frets")
        if len(self.points) != 2 * len(w):
            raise ValueError(f"{len(w)} fret wires need {2 * len(w)} points (both outer strings on each)")
        return self

    @property
    def wires(self) -> list[int]:
        return list(self.frets) if self.frets else [self.fret_a, self.fret_b]


class AnalysisOptions(BaseModel):  # changing these requires re-running analysis
    mode: Literal["monophonic", "allow_double_stops"] = "monophonic"
    segmenter: Literal["auto", "basic_pitch", "f0_first"] = "auto"
    string_model: Literal["auto", "on", "off"] = "auto"  # timbre classifier -> NoteEvent.string_probs
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


class Notice(BaseModel):
    """A warning the app shows, as a code it translates (server.notices in the web catalog) and its values. A
    `reason_code` value is itself a code (server.videoReasons). An empty code has no translation."""

    code: str
    params: dict[str, str | float] = Field(default_factory=dict)


class QualityReport(BaseModel):
    voiced_ratio: float = 0.0
    low_confidence_note_ratio: float = 0.0
    clipping: bool = False
    polyphony_detected: bool = False
    warnings: list[str] = Field(default_factory=list)  # English, for the CLI and older clients
    notices: list[Notice] = Field(default_factory=list)  # the same warnings, as codes the app translates
    # what the source-separation stage did (None: not attempted). Keys: used, stem, reason, backing_db, stems_db,
    # playback (stems uploaded for listening: "guitar", "backing")
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
    # where the video stage saw the neck over time, for the editor's overlay (None: no video stage).
    # Keys: time_offset_s, size [w, h], fret_a, fret_b, taper (neck spread, see VideoCalibration.guitar),
    #   samples [[t, tracked 0|1, x1, y1, .. x4, y4]] (calibration corners in this frame, normalised),
    #   tips [[t, x, y, finger]] (fingertips that counted as evidence, normalised)
    video_track: dict | None = None


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
    deleted_note_ids: list[str] = Field(default_factory=list)  # analysis notes the user removed (kept on re-assembly)

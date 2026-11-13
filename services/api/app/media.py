"""Uploaded media: ffprobe / ffmpeg wrappers and the upload check (what kind of file, within the limits?)."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .service import ServiceError

MB = 1024 * 1024


def probe(path: Path) -> dict:
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, check=True, timeout=60,
        )
    except FileNotFoundError as e:
        raise ServiceError(500, "ffprobe is not installed on the server") from e
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise ServiceError(422, "Could not read the file: it is not a valid audio or video file") from e
    return json.loads(res.stdout or "{}")


def frame_jpeg(path: Path, t: float) -> bytes:
    """One frame as JPEG, at most 1280 px wide. ffmpeg applies the phone's rotation."""
    try:
        res = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.3f}", "-i", str(path), "-frames:v", "1",
             "-vf", "scale='min(1280,iw)':-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "-"],
            capture_output=True, check=True, timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise ServiceError(422, "Could not grab a frame at this time") from e
    if not res.stdout:
        raise ServiceError(422, "This time is outside the video")
    return res.stdout


@dataclass
class MediaInfo:
    kind: str  # audio | video
    duration_s: float
    probe: dict  # the parts worth keeping


def inspect(path: Path, size: int, settings: Settings) -> MediaInfo:
    """Probe a stored upload and enforce the limits. Raises ServiceError when the file is not usable."""
    info = probe(path)
    streams = info.get("streams", [])
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    has_video = any(s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic") for s in streams)
    if not has_audio:
        raise ServiceError(422, "The file has no audio stream")
    kind = "video" if has_video else "audio"
    if kind == "audio" and size > settings.max_audio_mb * MB:
        raise ServiceError(413, f"Audio is larger than {settings.max_audio_mb} MB")
    duration = float(info.get("format", {}).get("duration") or 0.0)
    if duration > settings.max_duration_s:
        raise ServiceError(422, f"File is {duration:.0f}s long, the maximum is {settings.max_duration_s}s")
    kept = {"format": info.get("format", {}).get("format_name"), "streams": [
        {k: s.get(k) for k in ("codec_type", "codec_name", "sample_rate", "channels", "width", "height")} for s in streams]}
    return MediaInfo(kind=kind, duration_s=duration, probe=kept)

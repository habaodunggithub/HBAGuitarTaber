# Desktop app

The web editor, the API and the local analysis worker in one installable app for Windows, macOS (Apple Silicon)
and Linux. Same flow as `just app` + `just worker`; the pipeline is not touched. Design and trade-offs:
[ADR-011](../../docs/adr/ADR-011-desktop-app.md) (shell and runtime), [ADR-012](../../docs/adr/ADR-012-distribution.md) (releases and download page).

## How it works

- **Installer (~150–250 MB)**: Electron shell, the built SPA, the project's three wheels, requirement files exported
  from `uv.lock` (one per runtime variant), `uv`, and an LGPL FFmpeg.
- **First run**: the setup screen detects the hardware and offers a runtime. `uv` then installs Python 3.12 and exactly
  the locked packages:

  | Variant | Where | torch |
  |---|---|---|
  | `gpu` | Windows / Linux with NVIDIA (driver R580+) | Windows `+cu132` (PyTorch index), Linux the PyPI CUDA build |
  | `cpu` | Windows, Linux, Apple Silicon | Linux `+cpu`, without the ~4 GB CUDA libraries |
  | `lite` | anywhere | none: pYIN, Basic Pitch ONNX, MediaPipe video |

  macOS builds are Apple Silicon only and need macOS 14 or newer: the locked numpy, scipy, onnxruntime and torch
  wheels are `macosx_14_0_arm64`.

  Later launches skip straight to the app. An app update re-syncs the runtime only when the lock or the wheels changed.
- **Every launch**: `launch.py api`, then `launch.py worker` (pulling from `127.0.0.1`), then the window opens the SPA.
  The port is kept in `settings.json` because the SPA's localStorage is tied to it. The children exit on their own if
  the app dies (`python/launch.py` watches the parent).

| | Windows | macOS | Linux |
|---|---|---|---|
| Data, runtime, `settings.json` | `%LOCALAPPDATA%\HBA Guitar Taber` | `~/Library/Application Support/HBA Guitar Taber` | `~/.local/share/hba-guitar-taber` |
| Cache (models, stems, uv) | `…\HBA Guitar Taber\cache` | `~/Library/Caches/HBA Guitar Taber` | `~/.cache/hba-guitar-taber` |
| Logs (`desktop`, `runtime`, `api`, `worker`) | `…\HBA Guitar Taber\logs` | `~/Library/Logs/HBA Guitar Taber` | `~/.local/state/hba-guitar-taber/logs` |

`TABER_DESKTOP_HOME=/some/dir` puts all of it in one folder (portable use, tests).

## Develop

```bash
just web-build                 # the SPA the app serves
just desktop-stage             # stage/: wheels, requirements per variant, uv, ffmpeg (downloads the LGPL build)
just desktop                   # run the shell from source (first run shows the setup screen)
just desktop-smoke cpu         # no window: install the runtime, start API + worker, transcribe a take, export .gp5
just desktop-dist              # installers for this OS into apps/desktop/release/
```

`node scripts/stage.mjs --ffmpeg none` skips bundling FFmpeg and uses the one on `PATH` (local work only).
On macOS, build FFmpeg first: `scripts/build-ffmpeg-macos.sh ffmpeg-macos`, then `--ffmpeg ffmpeg-macos`.

## Release

```bash
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/desktop.yml` builds and smoke-tests on Windows, macOS and Linux, then drafts a Release with the
installers and `SHA256SUMS.txt`. Check it and press **Publish**: `.github/workflows/pages.yml` then refreshes the
download page. When torch is bumped in `uv.lock`, update the CUDA tag in `runtime.config.json` (stage fails loudly
if the PyTorch index has no matching wheel).

## Not done yet

- Code signing. Until then Windows shows SmartScreen ("More info → Run anyway") and macOS asks for
  "Open Anyway" in System Settings → Privacy & Security.
- Apple Silicon runs the models on the CPU: the pipeline only looks for CUDA, and the pipeline is not changed here.
- A first install on a real NVIDIA Windows machine has not been timed (CI has no GPU).

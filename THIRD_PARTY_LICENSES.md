# Third-party licenses

Read from the installed packages' metadata (not from memory). This is an inventory for ADR-008, **not legal
advice**. `ok_for_public`: `yes` = permissive; `review` = copyleft-style obligations to check before making the
service public (the app only imports these as unmodified libraries); `no` = must be replaced.

## Python

| Package | License | ok_for_public | Note |
|---|---|---|---|
| pesto-pitch 2.0.1 | LGPL-3.0 | review | pitch tracker (default); weights ship in the package |
| PyGuitarPro 0.11 | LGPL-3.0-only | review | .gp5 export |
| soxr 1.1.0 | LGPL-2.1-or-later | review | resampling (via librosa) |
| torchcrepe 0.0.24 | MIT | yes | CREPE pitch tracker; weights in package |
| demucs 4.1.0 (htdemucs_6s weights) | MIT | yes | guitar / backing separation; weights downloaded on first use |
| torch 2.15.0 | BSD/Apache-style (see package) | yes | |
| librosa 1.0.0 | ISC | yes | |
| mido 1.3.3, mir_eval 0.8.2, pyloudnorm 0.2.0 | MIT | yes | |
| numpy, scipy, scikit-learn, soundfile, httpx | BSD-3-Clause | yes | |
| pydantic, fastapi, SQLAlchemy | MIT | yes | |
| uvicorn, sse-starlette | BSD-3-Clause | yes | |

## JavaScript

| Package | License | ok_for_public | Note |
|---|---|---|---|
| @coderline/alphatab 1.9.0 (+ vite plugin) | MPL-2.0 | review | file-level copyleft: only matters if its source files are modified; Bravura and SONiVOX assets have their own licenses (shipped in the package) |
| wavesurfer.js 7 | BSD-3-Clause | yes | |
| react, zustand, @tanstack/react-query, react-router-dom | MIT | yes | |
| Six Caps, IBM Plex Mono, Caveat (fonts, via @fontsource) | SIL OFL 1.1 | yes | bundled into the SPA; OFL allows embedding, the fonts may not be sold on their own |

## Datasets

| GuitarSet | CC BY 4.0 | yes (with attribution) | used only for evaluation (ml/eval/separation_study.py), not for training, not redistributed |

Other datasets: none yet. Before using GuitarSet, IDMT-SMT-Guitar, EGDB, SynthTab or DadaGP, record each
license here: a model trained on non-commercial data inherits that restriction (flag it `no` for public use).

## Not installed (planned)

Beat This!, madmom (its model weights are non-commercial: `no`), Ultralytics YOLO (AGPL: `no`).

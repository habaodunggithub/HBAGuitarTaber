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
| Basic Pitch model `nmp.onnx` (Spotify, basic-pitch 0.4.0) | Apache-2.0 | yes | note-onset model, vendored at `packages/taber_ml/src/taber_ml/weights/basic_pitch_nmp.onnx` with its LICENSE and NOTICE; only the model file is used, the windowing code is re-written |
| onnxruntime 1.32.0 | MIT | yes | runs the Basic Pitch model |
| beat-this 1.1.0 (+ `final0` checkpoint, downloaded on first use) | MIT | yes | beat tracker; its authors note some of its training data has restrictive licenses, to assess before going public |
| String classifier weights `string_cnn.pt`, `string_cnn_large.pt` (this project) | trained on GuitarSet, CC BY 4.0 | yes, with attribution | GuitarSet: Q. Xi, R. Bittner, J. Pauwels, X. Ye, J. P. Bello, "GuitarSet: A Dataset for Guitar Transcription", ISMIR 2018 |

## Evaluation data (not shipped)

| Dataset | License | Use |
|---|---|---|
| GuitarSet | CC BY 4.0 | evaluation, tuning, and training of the string classifier |
| IDMT-SMT-Guitar V2 | CC BY-NC-ND 4.0 | **evaluation only** (no training, no tuning): the no-derivatives term rules out shipping anything learned from it |
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

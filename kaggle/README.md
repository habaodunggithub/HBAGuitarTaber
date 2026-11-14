# Kaggle (T4 x2)

Verified on Kaggle (2026-11-14): the wheels dataset and the `train_strings` notebook. The batch and pull-worker
notebooks share the same bootstrap but have not been run there yet.

## One-time

```bash
uv tool install kaggle            # or: pip install kaggle
kaggle auth login                 # phone-verified account needed for GPU + Internet
uv run python scripts/kaggle_prepare.py --user YOUR_KAGGLE_USERNAME     # -> kaggle/_build/
kaggle datasets create -p kaggle/_build/wheels                          # the code (taber-ir, taber-ml wheels)
kaggle kernels push -p kaggle/_build/hello                              # environment check (uses GPU hours)
kaggle kernels status YOUR_KAGGLE_USERNAME/taber-hello
```

Re-run `kaggle_prepare.py` and `kaggle datasets version -p kaggle/_build/wheels -m "msg"` after code changes.

## Batch (recommended way to use Kaggle)

1. Put recordings in a dataset `taber-takes` (`name.wav`, optional `name.di.wav`):
   `kaggle datasets create -p your_takes_dir`
2. `kaggle kernels push -p kaggle/_build/batch`, then `kaggle kernels output YOUR_KAGGLE_USERNAME/taber-batch -p out/`
3. `out/<name>/analysis.json.gz` -> `uv run taber assemble ...` on the laptop (instant, no GPU).

One worker process per GPU; results are written per file and finished files are skipped if you re-run.

## Things learned on the first real run (2026-11-14)

- A script notebook uploads **only its code file**. `kaggle_prepare.py` therefore inlines `_bootstrap.py`
  into each script; never push the templates in `kaggle/<name>/` directly.
- Kaggle runs Python 3.13. The training notebook installs only the two wheels (`install(extras=())`).
- Pushing a **new version** of an existing notebook failed with `409 ... title is already in use` until
  its numeric id was in the metadata: `kaggle kernels pull USER/NAME -p tmp -m`, copy `id_no` into
  `kaggle/_build/<name>/kernel-metadata.json`, push again.
- Dataset metadata needs a license name Kaggle accepts; `unknown` grants nothing (the code stays under
  the repository's LICENSE).

## Train the large string classifier

Kaggle's two T4s are for training, not for running the app: every model the worker runs at inference
fits the laptop's 6 GB. `taber-train-strings` trains the **large** string classifier (~0.9M parameters,
~460 ms of context, vs 58k / ~280 ms for the base one the laptop trained) on GuitarSet's microphone *and*
pickup recordings, with six amp-style variants of each take, as an ensemble of one network per GPU.

1. `uv run python scripts/kaggle_prepare.py --user YOUR_KAGGLE_USERNAME` and upload or version the
   `taber-wheels` dataset (above): the notebook runs the code from those wheels.
2. `kaggle kernels push -p kaggle/_build/train_strings` (uses GPU hours; it downloads ~1.4 GB of GuitarSet
   from Zenodo, so Internet must be ON). `TABER_SEEDS` (default 2) sets the ensemble size.
3. `kaggle kernels output YOUR_KAGGLE_USERNAME/taber-train-strings -p kaggle_out/`
4. Measure it on held-out data **before** installing it:
   `uv run python ml/eval/string_study.py --weights kaggle_out/string_cnn_large.pt`
   and compare with the base model (`ml/eval/string_study.json`).
5. If it is better on GuitarSet player 04 (validation), copy it to
   `packages/taber_ml/src/taber_ml/weights/string_cnn_large.pt`. Workers then use it automatically
   (laptop and Kaggle alike); `TABER_STRING_MODEL=base` switches back.

Result of the first run (2026-11-14, 2 seeds x 60 epochs, 103 min): validation 89.2% string+fret after
Viterbi (base 87.6%), IDMT electric 55.8% (base 52.9%), GuitarSet 05 81.9% (base 83.0%). It is installed as
the default; details in `docs/ARCHITECTURE.md` and `ml/eval/string_study_large.json`.

## Pull worker (optional)

Only needed if the laptop is too slow. Needs a **named** Cloudflare tunnel exposing *only* `/api/v1/worker/*`
(never the UI), and two Kaggle Secrets: `TABER_API_URL`, `TABER_WORKER_TOKEN` (content of `data/worker_token`).
The notebook exits by itself after 10 idle minutes because Kaggle bills session time, not utilisation.
Check the current quota and session limits on kaggle.com before long runs.

# Kaggle (T4 x2)

Nothing here has been run on Kaggle yet: this machine has no Kaggle CLI or credentials. What *was* verified
offline: metadata consistency, script syntax, that a clean venv can install only the two wheels and run
`taber batch`, and the batch/worker code paths (see `packages/taber_ml/tests`).

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

## Pull worker (optional)

Only needed if the laptop is too slow. Needs a **named** Cloudflare tunnel exposing *only* `/api/v1/worker/*`
(never the UI), and two Kaggle Secrets: `TABER_API_URL`, `TABER_WORKER_TOKEN` (content of `data/worker_token`).
The notebook exits by itself after 10 idle minutes because Kaggle bills session time, not utilisation.
Check the current quota and session limits on kaggle.com before long runs.

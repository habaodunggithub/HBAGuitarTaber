# HBA Guitar Taber — common tasks.  Install `just` with:  uv tool install rust-just
set shell := ["bash", "-euo", "pipefail", "-c"]

# the Python venv lives outside the (NTFS) project folder: torch is huge and slow to write there
export UV_PROJECT_ENVIRONMENT := env_var_or_default("UV_PROJECT_ENVIRONMENT", env_var("HOME") + "/.cache/taber/venv")
export UV_LINK_MODE := "copy"

default:
    @just --list

# one-time setup: Python (CPU + CUDA torch) and web dependencies
setup:
    uv sync --python 3.12 --all-packages --extra torch --extra video
    cd apps/web && pnpm install
    cd apps/web && npx playwright install chromium

# setup without torch (pyin pitch tracker only, much smaller)
setup-cpu:
    uv sync --python 3.12 --all-packages
    cd apps/web && pnpm install

# build the web app and serve it together with the API on http://127.0.0.1:8000
app: web-build
    uv run --no-sync taber-api

# the pull worker for this machine (RTX 4050 / CPU).  Start it in a second terminal.
worker *ARGS:
    uv run --no-sync taber worker --location local {{ARGS}}

# Vite dev server with hot reload (proxies /api to the API on :8000)
web-dev:
    cd apps/web && pnpm dev

web-build:
    cd apps/web && pnpm build

# regenerate the TypeScript API types from the FastAPI schema
gen-api:
    uv run --no-sync python scripts/dump_openapi.py
    cd apps/web && pnpm gen:api

# audio -> tab from the command line:   just transcribe solo.wav out/ [--di di.wav --capo 2 ...]
transcribe INPUT OUT *ARGS:
    uv run --no-sync taber transcribe {{INPUT}} -o {{OUT}} {{ARGS}}

# render the synthetic ground-truth licks to wav (needed by eval and the e2e tests)
synth-eval:
    for f in ml/eval/synthetic/*.tab.json; do uv run --no-sync taber synth "$f" -o ml/eval/synthetic; done

# metrics on the synthetic set (or your own: just eval path/to/dir)
eval DIR="ml/eval/synthetic" *ARGS="":
    uv run --no-sync taber eval {{DIR}} --csv ml/eval/results.csv {{ARGS}}

# metrics on YOUR checked takes (Test set button in the editor): where does the app go wrong?
#   just truth-eval                      re-transcribe every take with the current pipeline
#   just truth-eval --stored             score the analysis saved with each take (no models)
#   just truth-eval --strings off        compare: without the string classifier
truth-eval *ARGS:
    uv run --no-sync taber truth-eval data/truth {{ARGS}}

test-py:
    uv run --no-sync pytest packages services -q

test-web:
    cd apps/web && pnpm typecheck && pnpm test

test-e2e: web-build
    cd apps/web && npx playwright test

test: test-py test-web test-e2e

lint:
    uv run --no-sync ruff check packages services

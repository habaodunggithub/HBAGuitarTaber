"""Build the upload bundle for Kaggle into kaggle/_build/ (never edits the templates).

  python scripts/kaggle_prepare.py --user YOUR_NAME            # wheels + notebooks
  python scripts/kaggle_prepare.py --user YOUR_NAME --no-wheels  # only render the metadata

Then (after `kaggle auth login`):
  kaggle datasets create -p kaggle/_build/wheels            # first time; `datasets version` afterwards
  kaggle kernels push -p kaggle/_build/hello                 # environment check, uses GPU hours
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "kaggle"
PLACEHOLDER = "YOUR_KAGGLE_USERNAME"
NOTEBOOKS = ["hello", "batch", "worker", "train_strings"]


IMPORT = "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\nimport _bootstrap  # noqa: E402\n"


def inline_bootstrap(code: str) -> str:
    """Kaggle uploads only a script notebook's code file, never files next to it: embed _bootstrap.py
    (one source of truth in kaggle/) as a module built from its text."""
    if IMPORT not in code:
        return code
    src = (SRC / "_bootstrap.py").read_text(encoding="utf-8")
    embedded = (
        "import types  # noqa: E402\n"
        "_bootstrap = types.ModuleType(\"_bootstrap\")  # inlined from kaggle/_bootstrap.py by kaggle_prepare.py\n"
        f"exec(compile({src!r}, \"_bootstrap.py\", \"exec\"), _bootstrap.__dict__)\n"
    )
    return code.replace(IMPORT, embedded)


def render(user: str, out: Path, wheels: bool) -> list[Path]:
    if out.name != "_build" or ROOT not in out.resolve().parents:
        raise SystemExit(f"refusing to write outside <repo>/**/_build: {out}")
    written: list[Path] = []
    for name in NOTEBOOKS:
        dst = out / name
        dst.mkdir(parents=True, exist_ok=True)
        for f in (SRC / name).iterdir():
            if f.is_file():
                text = f.read_text(encoding="utf-8").replace(PLACEHOLDER, user)
                if f.suffix == ".py":
                    text = inline_bootstrap(text)
                (dst / f.name).write_text(text, encoding="utf-8")
                written.append(dst / f.name)
        stale = dst / "_bootstrap.py"
        if stale.exists():
            stale.unlink()
    wdir = out / "wheels"
    wdir.mkdir(parents=True, exist_ok=True)
    meta = (SRC / "wheels" / "dataset-metadata.json").read_text(encoding="utf-8").replace(PLACEHOLDER, user)
    (wdir / "dataset-metadata.json").write_text(meta, encoding="utf-8")
    written.append(wdir / "dataset-metadata.json")
    if wheels:
        for old in wdir.glob("*.whl"):
            old.unlink()
        for pkg in ("taber-ir", "taber-ml"):  # uv build takes one --package per call
            subprocess.run(["uv", "build", "--package", pkg, "--wheel", "-o", str(wdir)], cwd=ROOT, check=True)
        written += sorted(wdir.glob("*.whl"))
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="your Kaggle username")
    ap.add_argument("--out", default=str(SRC / "_build"))
    ap.add_argument("--no-wheels", action="store_true")
    a = ap.parse_args()
    if not a.user.replace("-", "").replace("_", "").isalnum():
        raise SystemExit("invalid Kaggle username")
    files = render(a.user, Path(a.out), not a.no_wheels)
    for f in files:
        print(" ", f.relative_to(ROOT))
    for n in NOTEBOOKS:
        json.loads((Path(a.out) / n / "kernel-metadata.json").read_text())  # fail early on broken JSON
    print("\nNext:\n  kaggle datasets create -p kaggle/_build/wheels\n  kaggle kernels push -p kaggle/_build/hello")
    return 0


if __name__ == "__main__":
    sys.exit(main())

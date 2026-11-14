"""The Kaggle bundle can't be run here (no account), so check everything checkable offline."""
from __future__ import annotations

import ast
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
KAGGLE = ROOT / "kaggle"
NOTEBOOKS = ["hello", "batch", "worker", "train_strings"]


def load_prepare():
    spec = importlib.util.spec_from_file_location("kaggle_prepare", ROOT / "scripts" / "kaggle_prepare.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["kaggle_prepare"] = mod
    spec.loader.exec_module(mod)
    return mod


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


@pytest.mark.parametrize("name", NOTEBOOKS)
def test_metadata_is_consistent(name):
    meta = json.loads((KAGGLE / name / "kernel-metadata.json").read_text())
    assert meta["id"].split("/")[1] == slug(meta["title"]), "Kaggle needs the title to slugify to the id"
    assert (KAGGLE / name / meta["code_file"]).exists()
    assert meta["kernel_type"] == "script" and meta["language"] == "python"
    assert meta["enable_gpu"] == "true" and meta["enable_internet"] == "true"  # pip needs Internet
    assert meta["is_private"] == "true"
    assert "YOUR_KAGGLE_USERNAME/taber-wheels" in meta["dataset_sources"]
    assert all(s.startswith("YOUR_KAGGLE_USERNAME/") for s in meta["dataset_sources"])


@pytest.mark.parametrize("name", NOTEBOOKS)
def test_scripts_parse_and_leak_no_secrets(name):
    code = (KAGGLE / name / f"{name}.py").read_text()
    ast.parse(code)
    assert not re.search(r"(token|secret|key)\s*=\s*['\"][A-Za-z0-9_\-]{16,}['\"]", code, re.I)
    if name == "worker":
        # the token must travel through the environment, not the visible command line
        assert "--token" not in code


def test_bootstrap_parses_and_dataset_metadata():
    ast.parse((KAGGLE / "_bootstrap.py").read_text())
    ds = json.loads((KAGGLE / "wheels" / "dataset-metadata.json").read_text())
    assert ds["id"] == "YOUR_KAGGLE_USERNAME/taber-wheels" and slug(ds["title"]) == "taber-wheels"


def test_prepare_renders_username_and_copies_bootstrap(tmp_path):
    prep = load_prepare()
    import shutil

    out = ROOT / "kaggle" / f"_test_{tmp_path.name}" / "_build"  # never the real kaggle/_build
    files = prep.render("alice-01", out, wheels=False)
    try:
        for n in NOTEBOOKS:
            meta = json.loads((out / n / "kernel-metadata.json").read_text())
            assert meta["id"].startswith("alice-01/") and "YOUR_KAGGLE_USERNAME" not in json.dumps(meta)
            # Kaggle uploads only the code file: the bootstrap must be inside it
            code = (out / n / f"{n}.py").read_text()
            ast.parse(code)
            assert "import _bootstrap" not in code and "_bootstrap.install(" in code
            assert not (out / n / "_bootstrap.py").exists()
        assert len(files) >= 9
    finally:
        shutil.rmtree(out.parent, ignore_errors=True)


def test_prepare_refuses_to_write_elsewhere(tmp_path):
    prep = load_prepare()
    with pytest.raises(SystemExit):
        prep.render("alice", tmp_path / "somewhere", wheels=False)

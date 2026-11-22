"""Every code the server sends for the app to translate has English text in the app's catalog, with its values."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCES = [*(ROOT / "packages/taber_ml/src").rglob("*.py"), *(ROOT / "services/api/app").rglob("*.py")]
CATALOG = (ROOT / "apps/web/src/i18n/en.ts").read_text(encoding="utf-8")
SERVER = CATALOG[CATALOG.index("\n  server: {") : CATALOG.index("\n  },", CATALOG.index("\n  server: {"))]

# the call that sends a code, and the code; \s* lets a call span lines
PATTERNS = {
    "notices": [r'\bwarn\(\s*"(\w+)"', r'\bwarning_code="(\w+)"'],
    "videoReasons": [r'"reason_code": "(\w+)"', r'\breason_code="" if \w+ else "(\w+)"'],
    "errors": [r'(?<!\w)code="(\w+)"'],
}


def section(name: str) -> str:
    """`name: { ... }` inside the catalog's `server` block."""
    start = SERVER.index(f"\n    {name}: {{")
    return SERVER[start : SERVER.index("\n    },", start)]


def sources() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in SOURCES)


def test_every_server_code_has_text_in_the_catalog():
    text = sources()
    for name, patterns in PATTERNS.items():
        keys = set(re.findall(r"^\s+(\w+):", section(name), re.M))
        found = {c for pat in patterns for c in re.findall(pat, text)}
        assert found, f"no {name} codes found in the server source: the patterns are stale"
        assert found <= keys, f"server.{name} in apps/web/src/i18n/en.ts lacks {sorted(found - keys)}"


def test_every_warn_call_names_its_code_literally():
    # a code in a variable would slip past the test above
    calls = re.findall(r"(?<!def )\bwarn\(\s*([^,]+),", sources())
    assert calls and all(re.fullmatch(r'"\w+"|info\.warning_code or ""', c.strip()) for c in calls), calls


def test_values_sent_with_errors_are_the_ones_the_catalog_reads():
    text = sources()
    for code, params in re.findall(r'code="(\w+)", params=\{([^}]*)\}', text):
        sent = set(re.findall(r'"(\w+)":', params))
        line = next(ln for ln in section("errors").splitlines() if re.match(rf"\s+{code}:", ln))
        read = set(re.findall(r"p\.(\w+)", line))
        assert sent == read, f"{code}: the server sends {sorted(sent)}, the catalog reads {sorted(read)}"


def test_progress_lines_keep_the_wording_the_app_recognizes():
    # the worker's progress lines are plain text; the app knows them by these exact words (i18n/index.ts progressText)
    text = sources()
    assert 'f"Downloading the {w.label}, first time only: {weights.mb(done)} of {weights.mb(total)}"' in text
    progress = SERVER[SERVER.index("\n    progress: {") :]
    for line in ("Temporary error, retrying", "Worker lost connection, re-queuing"):
        assert f'"{line}"' in text and f"'{line}'" in progress, line
    labels = set(re.findall(r'Weight\(\s*"\w+",\s*"([^"]+)"', text))
    assert labels and labels <= set(re.findall(r"'([^']+)': '", section("models"))), labels

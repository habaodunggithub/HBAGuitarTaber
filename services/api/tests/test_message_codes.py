"""Every code the server sends for the app to translate has English text in the app's catalog."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCES = [*(ROOT / "packages/taber_ml/src").rglob("*.py"), *(ROOT / "services/api/app").rglob("*.py")]
CATALOG = (ROOT / "apps/web/src/i18n/en.ts").read_text(encoding="utf-8")

# warn("code", ...) / code="..." / warning_code="..." / "reason_code": "..." / reason_code="" if ... else "..."
PATTERNS = {
    "notices": [r'warn\("(\w+)"', r'warning_code="(\w+)"'],
    "videoReasons": [r'"reason_code": "(\w+)"', r'reason_code="" if \w+ else "(\w+)"'],
    "errors": [r'(?<!\w)code="(\w+)"'],  # not warning_code= / reason_code=
}


def section(name: str) -> str:
    """The text of `name: { ... }` inside the catalog's `server` block."""
    start = CATALOG.index(f"    {name}: {{")
    return CATALOG[start : CATALOG.index("\n    },", start)]


def codes(patterns: list[str]) -> set[str]:
    found: set[str] = set()
    for p in SOURCES:
        text = p.read_text(encoding="utf-8")
        for pat in patterns:
            found |= set(re.findall(pat, text))
    return found


def test_every_server_code_has_text_in_the_catalog():
    for name, patterns in PATTERNS.items():
        keys = set(re.findall(r"^\s+(\w+):", section(name), re.M))
        found = codes(patterns)
        assert found, f"no {name} codes found in the server source: the patterns are stale"
        assert found <= keys, f"server.{name} in apps/web/src/i18n/en.ts lacks {sorted(found - keys)}"

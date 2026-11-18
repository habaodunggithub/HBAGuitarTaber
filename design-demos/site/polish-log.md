# Polish log: download page drafts (2026-11-18)

Screens checked at 1440×900 (every slice) and 375×812 (first screens), Chromium via Playwright.
Lint: `design_lint.py check` (Python Playwright 1.65.0 via `uv run --with`), `compare --brand`: "三版拉开了"
(skeleton correlation 0.15 / 0.48 / 0.19).

## Thumbnails (thumbs.html)
Six candidates. Kept 3 (product cropped), 2 (storyboard), 6 (listening wheel): strongest and most different.
Alternates: 1 (thumb index: a prop, removing the tabs would not lose information), 4 (one button: too close to 3,
both lead with a screenshot), 5 (one object: says nothing about what the app does).

## dir-1 · product cropped (Teenage Engineering reading)
Round 1, worst three:
1. Horizontal scroll on desktop and phone: the bleeding screenshot widened the page → `overflow-x: clip` on html/body.
2. Callout dots sat on the parts they point at (covered "Export", "Guitar") → moved beside them.
3. Phone: no product on the first screen (screenshot after the legend) → reordered: sentence, tags, screenshot, text, button.
Also: a small label above every heading (template) → replaced by one sentence of real content under each heading.
Lint: 13 px body text (12 places) → 14 px; `--ink-3` contrast 4.24 → #5c564a.

## dir-2 · storyboard (Oliver Jeffers reading)
Round 1, worst three:
1. Phone: drawings ran into the captions inside the panels → fixed art height on narrow screens.
2. "Drawn to scale" was not true → one jar shape, width ∝ √GB, so the area is the download (100 / 41 / 29 %).
3. Panel 3's real lane crop was unreadable → tighter crop on the notes.
Lint: middle-dot joins in the meta line and the formats → plain sentences.

## dir-3 · listening wheel (Sugiura information mandala, seconds wheel 19)
Round 1, worst three:
1. The caption box covered the rim text → moved to the wheel's corner.
2. Title with one word in another colour (template) → removed.
3. Small text (13 px) in the note, caption, stage list, footer → 14 px.
Kept on purpose: the middle dots on the rings (they are the wheel's content); the wheel is aria-hidden and the
numbered stage list is its accessible, keyboard-reachable equivalent.

## Not changed (all three)
- Relative image paths: the real site is a folder (site/), not a single double-clicked file.
- "Mono small labels": IBM Plex Mono is the brand's body font.

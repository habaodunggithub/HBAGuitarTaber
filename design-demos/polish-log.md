# Polish log (direction drafts, round 1)

## dir-1 Field sketchbook
- Headline grain read as grey static, not ink → fewer holes in the ink filter.
- Guitar horns read as ears → redrew the body outline (still a sketch, refine after the pick).
- Drop zone and recent-tab waypoints sat on top of the amp and the guitar → scaled the scene, moved both; tab lines drew on top of their labels (CSS selector hit the inner SVG) → fixed; amp grille pattern invisible → fill fixed.

## dir-2 Watercolor plate
- Illustration missing inside the plate (template and target shared an id) → fixed.
- Guitar overflowed the plate bottom → scaled to fit.
- Wet-paper trail read as a dirty smear → fainter, larger, sparser blooms.

## dir-3 Logbook collage
- Guitar fills not rendered (class fill:none beat the attribute) → fixed.
- Readouts sat under the big record → moved to the right column; record pushed to the edge.
- Top record covered most of the headline → smaller and higher.

Not run: polish.py / design_lint.py need Python playwright (not installed); screenshots were checked by eye instead.

# Implementation (direction 1 in the real app)

## Round 1
- Search box swallowed by getByLabel('Guitar recording'): the hero section's accessible name contained the phrase → dropped aria-labelledby.
- "SOLO" cut at the baseline: the ink-in clip-path stayed after the animation and Six Caps overflows its line box → clip released after the animation (fill-mode backwards, wider inset).
- Night mode checked end to end: the circle spreads from the lamp, alphaTab and the waveform repaint, the choice survives reloads and page changes.

## Round 2
- Long library list rendered as empty rows (content-visibility skipped them) → removed, the list is short.
- "Add a DI track" broke into two columns in the narrow composer → block label.
- Mobile 390px: no horizontal scroll; deck, transport and lane stack cleanly.

# Iteration 2: musician's notebook + metronome

## Round 1
- Note name "A4" lost its display type (the new handwritten-label class overrode it) → restored for .pixel-h.note-name.
- Pendulum reached too far outside the metronome face → amplitude 24° → 17°.
- Fretboard position dots inherited the wobbly button outline and turned into boxes → kept them as pills.

## Round 2
- Day, night and 390px mobile checked; the spiral binding is fixed to the viewport (only shows on the first screen of full-page captures, correct while scrolling).
- Metronome verified by measurement in E2E: swings to both ends while playing, fewer swings at 50%, settles to rest on pause, still under reduced motion.

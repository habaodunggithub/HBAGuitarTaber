# Spec: Taber redesign (direction drafts)

**What it is:** Taber, a personal web app that listens to a guitar solo recording (audio or a phone video) and writes the tab: string, fret, rhythm, techniques. The player then fixes it in an editor that plays along with the audio.
**Audience:** one guitarist (the owner), practicing at a desk, coming back several times a week.
**Key screen for the drafts:** the home screen at 1440×900: what the app does, the place to drop a recording, the recent tabs, the worker status.
**Real content (English, from the app):**
- Headline idea: turn a guitar recording into tab
- Drop zone: "Drop a guitar recording" (wav, mp3, flac, m4a, ogg; mp4, mov, webm video)
- Recent tabs: box_techniques (Ready, 110 BPM, C major), a_minor_lick (Ready, 100 BPM, C major), fast_run (Analyzing 29%)
- Analysis steps (a real sequence): Reading audio, Removing backing track, Finding the beat, Tracking pitch, Finding notes and techniques, Reading the fretting hand, Checking quality
- Facts that can be annotations: Tuning E standard, Key C major, Tempo 110 BPM, worker online
**Tone:** the user's references: illustrated sketchbook editorial (Wander the Horizon / Дом на Хлебном / Beyond the Tide / Nefela): paper, hand ink, watercolor, condensed display type, mono field notes, one hidden interaction in the illustration.
**Must:** interactive effects that mean something; readable (body ≥14px, labels ≥12px); keyboard reachable.
**Output:** 3 single-file HTML drafts, 1440×900, design-demos/dir-1..3.html
**Assets:** tier T0 (no image generation): illustrations are hand-built SVG with ink/watercolor filters.

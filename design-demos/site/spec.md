# Spec: download page for the desktop app (GitHub Pages)

**What it is:** the public page where anyone downloads HBA Guitar Taber for Windows, macOS or Linux. Installers live on
GitHub Releases; the page reads `latest.json` (site/download.js). Hosted at habaodunggithub.github.io/HBAGuitarTaber.
**Audience:** guitarists who play solos and want them written down (hobby to serious), arriving from GitHub or a shared
link; mostly on a desktop (to download), sometimes on a phone (to read and come back).
**Assumptions (no answer asked: long unattended session):** English page, like the app's UI and the README; same brand
as the app (approved "musician's notebook", direction-approved.md of 2026-11-13); no testimonials, no user counts.

**Messages, in order of weight**
1. A recorded guitar solo becomes an editable tab: string, fret, rhythm, techniques (bends, vibrato, slides, whammy).
2. Download for your OS: version, size, requirement (Windows 10/11 x64; macOS 14+ Apple Silicon; Linux x86-64 AppImage / .deb, glibc 2.35+).
3. It runs on your computer. Recordings never leave it. The first launch installs the listening engine once:
   NVIDIA GPU (3–4 GB download), Processor (about 0.6 GB), Lite (about 0.3 GB).
4. How it works: drop a recording (wav, mp3, flac, m4a, ogg; or a phone video) → the engine listens (separation, beats,
   pitch, notes, strings, the fretting hand in video) → fix it in the editor, play along → export Guitar Pro .gp5, MusicXML, MIDI, ASCII tab.
5. Honest limits: monophonic solos; electric guitar is the hard case (39% of notes fully right on unseen electric licks,
   77% on acoustic); hammer-ons/pull-offs not detected from audio yet.
6. First launch of an unsigned app: Windows SmartScreen "More info → Run anyway"; macOS System Settings → Privacy &
   Security → "Open Anyway"; Linux `chmod +x` the AppImage.
7. Footer: source on GitHub, License (proprietary, by Ha Van Thien Bao), third-party licenses, SHA256SUMS, release notes.

**Tone:** a musician's notebook: ink, paper, handwriting, one cobalt accent, highlighter. Calm, specific, a bit of wit.
**Output:** one HTML page per direction, 1440×900 first screen, must work at 375×812. Fonts self-hosted (no requests to
other hosts), page usable without JS (links fall back to the Releases page).
**Must:** body ≥14px (16 on phones), labels ≥12px, contrast ≥4.5:1, keyboard reachable, real content only.
**Assets (T0):** real screenshots made with the desktop runtime: `assets/editor.webp` (editor, box_techniques),
`assets/home-hero.webp` (home), `assets/home-recent.webp` (tab list); the app icon (blue pick on staff paper).

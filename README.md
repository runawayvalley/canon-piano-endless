# Canon · Endless

Pachelbel's *Canon in D* on piano and soft strings, generated forever in your browser. Never the same way twice.

**Play it:** https://runawayvalley.github.io/canon-piano-endless/

## How it works

A seeded generative engine (`src/engine/`) writes one cycle at a time: 2 bars, 8 chords, over the Canon's ground bass `D – A – B – F# – G – D – G – A`.

- **Variations:** a skeleton line per cycle (the famous `F# E D C# B A B C#`, Pachelbel's descent, or a voice-led walk over chord tones), shaped by rhythmic figures: half notes, rolled chords, eighths, dotted skips, broken octaves, Alberti, sixteenth runs.
- **Energy waves:** energy drifts slowly between quiet and full, choosing figures, left-hand style, canon voices and strings.
- **Canon:** at higher energy a second (and in Bright, third) voice replays the line from 2 bars earlier, with strong-beat semitone clashes removed.
- **Key journeys:** prepared modulations (♭VI–♭VII lift or IV–V7) to E♭, F, G or B♭, always back to D within ~10 minutes. Toggle *Stay in D* to turn them off.
- **Modes:** *Calm / Focus* (gentle, no sixteenths, quiet string pad) and *Bright* (runs, 3-voice canon, cello and violins at the peaks).
- **Seeds:** the same seed plays the same performance. Copy a link from Settings to share one.

## Run locally

Any static server works, e.g. `python3 -m http.server`, then open http://localhost:8000.

Tests (engine only, no browser): `npm test`

## Credits

- Piano: [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC-BY 3.0 (served from tonejs.github.io)
- Strings: [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE), CC0 (violin and cello section sustains, trimmed to mp3 in `samples/strings/`)
- Audio engine: [Tone.js](https://tonejs.github.io/)

See `PLAN.md` for the design plan and milestones.

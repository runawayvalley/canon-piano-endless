# Canon · Endless

Pachelbel's *Canon in D* on piano and soft strings, generated forever in your browser. Never the same way twice.

**Play it:** https://runawayvalley.github.io/canon-piano-endless/

## How it works

A seeded generative engine (`src/engine/`) writes one cycle at a time: 2 bars, 8 chords, over the Canon's ground bass `D – A – B – F# – G – D – G – A`.

- **Variations:** a skeleton line per cycle (the famous `F# E D C# B A B C#`, Pachelbel's descent, or a voice-led walk over chord tones), shaped by rhythmic figures: half notes, rolled chords, eighths, dotted skips, broken octaves, Alberti, sixteenth runs.
- **Energy waves:** energy drifts slowly between quiet and full, choosing figures, left-hand style, canon voices and strings.
- **Canon:** at higher energy a second (and in Bright, third) voice replays the line from 2 bars earlier, with strong-beat semitone clashes removed.
- **Key journeys:** prepared modulations (♭VI–♭VII lift or IV–V7) to E♭, F, G or B♭, always back to D within ~10 minutes. Toggle *Stay in D* to turn them off.
- **Modes:** *Calm / Focus* (gentle, no sixteenths, quiet string pad), *Bright* (runs, 3-voice canon, cello and violins at the peaks) *Masterpiece* (up to 4 canon voices, violin counter-melodies, always full), *Extreme* (70 BPM, up to 6 canon voices, frequent key changes) and *Mythical* (48 BPM, slow and vast, up to 12 voices, a peak busier than Extreme's, see below). Each mode has its own look: drifting dust and soft glow, golden sparks, aurora ribbons with ripples, or a pale moon over a jade aurora.
- **Mythical's twelve voices:** not twelve stacked replays, which would blur into one chord: each voice has its own part of the melody. Lead; three canon lines (the melody from 2, 4 and 6 bars ago); alto harmony; a tenor tolling the lower octave; bells echoing it an octave up; a harp rolling under it; first violins singing its outline, second violins beneath them, a descant with Pachelbel's other theme, and a cello singing the outline from 2 bars ago. It opens with the lead alone, the voices gather one by one as the energy climbs, and all twelve sound together only at the peak, where the melody also arches highest. Below the peak nothing moves faster than an eighth. At the peak the lead breaks into sixteenth runs (which the three canon lines then replay), the alto shadows it a third below, the left hand rolls the chord over a held octave, and harp and bells sweep in thirty-seconds in opposite directions: about 25 piano notes a second against Extreme's 21, at no higher level. So that the top stays audible under all that, the bells and the highest canon line are lifted there, the left hand gives way by about a quarter, and the longer reverb that opens up while Mythical plays takes less of the left hand and cellos than of everything else. *Canon voices* off silences the extra piano voices, *Soft strings* off the four string voices.
- **Music only:** one tap (or M) hides the animation and stops all drawing, for background listening; audio keeps playing smoothly in a background tab.
- **Backing track:** optional Canon bassline on cello an octave above the piano's left hand (legato in Calm, driving eighths in the other modes) plus a sub-octave for headphones, with its own volume.
- **Seeds:** the same seed plays the same performance. Copy a link from Settings to share one.

## Run locally

Any static server works, e.g. `python3 -m http.server`, then open http://localhost:8000.

Tests (engine only, no browser): `npm test`

## Credits

- Piano: [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, CC-BY 3.0 (served from tonejs.github.io)
- Strings: [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE), CC0 (violin and cello section sustains, trimmed to mp3 in `samples/strings/`)
- Audio engine: [Tone.js](https://tonejs.github.io/)

See `PLAN.md` for the design plan and milestones.

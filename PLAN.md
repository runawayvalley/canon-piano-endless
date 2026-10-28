# Canon Piano Endless — Plan

## Goal

A **website that plays Pachelbel's *Canon in D* on piano with soft strings, forever, never repeating the same way twice.** Press play and a generative engine keeps spinning new variations over the ground bass: gentle, flowing, recognizably Canon at every moment. Static site, runs entirely in the browser, hosted free on GitHub Pages.

## What must stay (identity anchors)

1. **The ground bass.** `D – A – B – F# – G – D – G – A`, one note per beat, transposed with the key. Present in every cycle (only its rhythm and register vary).
2. **The 8-chord progression** I – V – vi – iii – IV – I – IV – V. Recoloured (add9, maj7, sus) but same shape.
3. **The famous line.** `F# – E – D – C# – B – A – B – C#` returns at least once every ~2 minutes, contour intact.
4. **Variation-over-a-ground.** Each 2-bar cycle is a new variation; never two identical cycles in a row.

## How "endless" works (the engine)

- **Clock:** one cycle = 2 bars of 4/4 = 8 chords. The engine always schedules the next cycle ~1 cycle ahead (look-ahead scheduler on the Web Audio clock, so no drift or gaps).
- **Variation library:** ~25–40 hand-written right-hand patterns as scale degrees over each chord (Pachelbel's own: half notes, quarter steps, 8th-note runs, 16th arpeggios, dotted skips, broken octaves, Alberti, pentatonic sparkle). Degrees, not pitches, so every pattern works in any key.
- **Left-hand styles:** plain ground, octave ground, broken chords, rolled arpeggios, sparse (bass on beat 1 only).
- **Chooser:** a weighted random walk over an *energy* level (1–5). Patterns are tagged by energy; energy drifts slowly up and down (a "wave" every 3–6 min), so the music breathes. The selected **mode** sets the energy range (see Modes).
- **Canon voices:** at higher energy, a 2nd (and rarely 3rd) right-hand voice enters playing the same pattern 2 bars later, exactly as Pachelbel wrote it. Clash check in code: drop a voice note that makes a semitone with another on a strong beat.
- **Key journey (on by default):** every so often (rate set by mode), modulate, always prepared with a pivot chord or a ♭VI–♭VII lift plus a short breath, never a bare jump. Routes: D → E♭ → F → D, D → G → D, D → B♭ → D (♭VI colour). Max ~3 semitones above D, and always comes home to D within ~10 min. Bright mode modulates more often (every 16–24 cycles) than Calm/Focus (every 24–40). A "Stay in D" toggle turns it off.
- **Seeded RNG:** everything comes from one seed. The same seed = the same performance, so a link like `?seed=4821` can be shared.
- **Humanize:** ±10 ms timing, velocity jitter, phrase-end ritardando, soft sustain pedal per chord.

## Modes

| | **Calm / Focus** (default) | **Bright** |
| --- | --- | --- |
| Energy range | 1–3 | 2–5 |
| Tempo default | 56 BPM | 66 BPM |
| Right-hand patterns | half/quarter notes, gentle 8ths, rolled chords; no 16ths | adds 16th runs, arpeggios, broken octaves, dotted skips |
| Canon voices | max 2 | up to 3 at peaks |
| Strings | slow pad only, low volume | pad + violins sing the famous line at peaks, cello doubles the ground |
| Energy waves | slow (5–8 min), few peaks | faster (3–5 min), clear climaxes |
| Key changes | rare (every 24–40 cycles) | more often (every 16–24 cycles) |
| Feel | study / sleep / background, steady and unobtrusive | singing, lifting, concert-like |

Switching mode mid-play takes effect at the next cycle boundary with a 1-cycle crossfade of energy, never a jolt.

### Added after v1
- **Masterpiece mode:** energy 3–5, 62 BPM, up to 4 canon voices (2, 4 and 6 bars behind), mixed figures, violins sing the famous line or Pachelbel's descent as a counter-melody, key changes every 16–28 cycles.
- **Extreme mode:** energy 4–5, 70 BPM, up to 6 canon voices (5 usually; voices 5–6 from 8 and 10 bars back, an octave below/above), no unison doubling, key changes every 12–20 cycles; ember-red visuals with a pulse on bass hits.
- **Backing track (optional):** the ground bass on cello (plus a low octave) on every beat from the first cycle, own volume; replaces the strings' cello layer when on.
- **Per-mode animation:** Calm = slow 6 s fall, soft glow, drifting dust; Bright = warm gold, sparks from every landing note; Masterpiece = fast fall, aurora ribbons tinted by key, ripples on every hit.

## Soft strings

- **Role:** support, never lead in Calm. Three layers, each entering by energy:
  1. **Pad** (energy ≥ 2): sustained chord tones (3rd/5th/7th, no root doubling with the ground), slow attack (~0.8 s), long release.
  2. **Cello/bass** (energy ≥ 3): doubles the ground bass an octave below the piano, legato.
  3. **Violins** (Bright, energy ≥ 4): play the famous line in long notes over the piano's variations, or a 2-bar-delayed canon voice.
- **Dynamics:** strings swell into each key change and at energy peaks, then thin out; they drop out entirely for a few cycles now and then so the solo piano breathes.
- **Samples:** **VSCO 2 Community Edition** (CC0, free) string ensemble sustains, or **Sonatina Symphonic Orchestra** (CC Sampling Plus) as fallback. Loaded in the background after the piano starts, so first sound stays fast. ~5–8 MB.
- Toggle: Strings on/off.

## Sound

- **Tone.js** for scheduling + sampled instruments.
- **Salamander Grand Piano** samples (free, CC-BY; Yamaha C5), ~15 sample notes stretched across the keyboard, loaded on first press of Play (~3–5 MB, cached).
- Strings as above. Shared reverb (strings a bit wetter than piano), gentle limiter.

## Page (what the user sees)

- Full-screen, calm, dark. Title, one big **Play / Pause** button.
- **Visual:** falling-note "piano roll" onto a small keyboard at the bottom, ground notes in one colour, canon voices in others, strings as soft glowing bands behind. Canvas, 60 fps, cheap on mobile.
- **Small info line:** current key, cycle number, energy, elapsed time ("Variation 142 · E♭ major · 18:04").
- **Mode switch** on the main screen: Calm / Focus · Bright.
- **Controls (tucked in a drawer):** tempo (50–80 BPM), strings on/off + strings volume, stay in D (key changes off), canon voices on/off, volume, seed + "share this performance" link, sleep timer (15 / 30 / 60 min, fades out).
- Keeps playing with the screen off on mobile where the browser allows (Media Session API for lock-screen controls).

## Tech stack

- Plain HTML + vanilla JS (ES modules) + Tone.js from CDN. No build step, so GitHub Pages serves the repo directly.
- Pure engine module (no audio) so it can be unit-tested in Node: given a seed, emit note events.

## Repo layout

```
canon-piano-endless/
├── index.html
├── src/
│   ├── engine/      # ground, progression, patterns, chooser, canon, modulation, rng
│   ├── audio/       # Tone.js piano + strings, scheduler, reverb
│   ├── ui/          # controls, piano-roll canvas, info line
│   └── main.js
├── test/            # Node tests for the engine (no browser)
├── PLAN.md
└── README.md
```

## Milestones

1. **Engine core.** Ground + progression + 8 patterns, seeded RNG, prints note events. Test: 1,000 cycles, every cycle has the ground, no identical neighbours.
2. **Plays in the browser.** Tone.js + Salamander piano, look-ahead scheduler, Play/Pause. Runs 1 hour without drift or gaps.
3. **Full variation library + energy waves + canon voices** with clash check; Calm/Focus and Bright modes.
4. **Key journeys** (prepared modulations, stay-in-D toggle) and the famous-line return rule.
5. **Soft strings.** Sample loading, pad / cello / violin layers by energy and mode, swells into key changes.
6. **Visuals and controls.** Piano roll, info line, mode switch, drawer controls, share-seed link, sleep timer, Media Session.
7. **Polish and deploy.** Humanize, reverb/mix, mobile check, README, GitHub Pages live.

## Review checks

- **Recognizable:** ground bass audible in every cycle; famous line within the first 30 s.
- **Endless and fresh:** no two consecutive cycles identical; listening 10 min feels like a journey, not a loop.
- **Seamless:** no clicks, gaps, or drift after 1 hour; works on Chrome, Safari (iOS), Firefox.
- **Modes feel different:** Calm/Focus never gets busy (no 16ths, strings quiet); Bright has clear lifts and climaxes.
- **Strings support:** never mask the piano melody in Calm; no clashes with the ground.
- **Key changes sound earned:** every modulation is prepared, and the piece returns to D.
- **Light:** first sound within ~3 s of pressing Play on decent Wi-Fi (strings load after).

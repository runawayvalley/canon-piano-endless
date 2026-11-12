// The endless Canon engine. Pure JS, no audio: each call to next() returns one
// cycle (2 bars = 8 chords = 8 beats) of note events. Same seed → same music.
import { makeRng } from './rng.js?v=14';
import {
  HOME, KEY_NAMES, GROUND, FAMOUS, DESCENT, mod12, tonicMidi, degToMidi,
  diatonicChord, pivotChord, nearestChordTone, chordTonesIn, chordToneAbove,
  chordToneBelow, isSemitoneClash, scaleStep,
} from './theory.js?v=14';
import { FIGURES } from './patterns.js?v=14';

export const MODES = {
  calm: {
    label: 'Calm / Focus', lo: 1, hi: 3, bpm: 56, maxVoices: 2, allow16: false,
    waveMin: [5, 8], modEvery: [24, 40], violins: false, voiceAt: [2.4], mix: 0.3,
  },
  bright: {
    label: 'Bright', lo: 2, hi: 5, bpm: 66, maxVoices: 3, allow16: true,
    waveMin: [3, 5], modEvery: [16, 24], violins: true, voiceAt: [2.8, 4.5], mix: 0.3,
  },
  masterpiece: {
    label: 'Masterpiece', lo: 3, hi: 5, bpm: 62, maxVoices: 4, allow16: true,
    waveMin: [4, 6], modEvery: [16, 28], violins: true, voiceAt: [3.1, 3.7, 4.3], mix: 0.7, counter: true,
  },
  extreme: {
    label: 'Extreme', lo: 4, hi: 5, bpm: 70, maxVoices: 6, allow16: true,
    waveMin: [3, 4], modEvery: [12, 20], violins: true, voiceAt: [4.0, 4.0, 4.1, 4.25, 4.4], mix: 0.85, counter: true,
  },
  // Slow, wide and grand. Twelve voices, but not twelve stacked replays: each one
  // has its own part of the melody (see MYTHIC_VOICES) and they gather one by one
  // as the energy climbs, so all twelve only sound together at the peak. For most of
  // the wave nothing moves faster than an eighth. On the last climb to the peak the
  // voices around the lead quicken in three steps (surge: the energy each step starts
  // at, see MYTHIC_VOICES), and at the peak itself (level peak16) the lead runs in
  // sixteenths, so the climax is busier than Extreme's even at this tempo and is
  // reached by a build rather than switched on.
  mythical: {
    label: 'Mythical', lo: 2, hi: 5, bpm: 48, maxVoices: 12, allow16: false, peak16: 5, surge: [4.2, 4.35, 4.5],
    waveMin: [4, 6], modEvery: [14, 24], violins: true, mix: 0.5, mythic: true, hall: 0.3,
    voiceAt: [2.2, 2.5, 2.8, 3.1, 3.4, 3.7, 3.9, 4.1, 4.3, 4.45, 4.6],
  },
};

// The eleven voices that join the lead in Mythical, in order of entry (paired with
// MODES.mythical.voiceAt). What each one does with the melody, and after the arrow
// what it turns into on the climb to the peak (the number is the surge step):
//   vln    violins sing the melody's outline in long notes
//   c2     canon: the melody from 2 bars ago, an octave below
//   harp   rolls through the chord under each melody note, rising and falling
//          → 2: sweeps the chord in thirty-seconds, up one beat and down the next
//   cel    cello sings the outline from 2 bars ago in the tenor register
//   alto   harmony: the chord tone under each melody note
//          → 1: shadows every note of the lead a third below, runs included
//   c3     canon: the melody from 4 bars ago
//   desc   descant: Pachelbel's other theme (the one the lead is not playing)
//   echo   bells: each melody note answered an octave higher, off the beat
//          → 1: peals in sixteenths over the melody, moving against the harp
//          → 3: peals in thirty-seconds
//   vln2   second violins, an open sixth or so under the first
//   c4     canon: the melody from 6 bars ago, an octave above
//   tenor  tolls the melody an octave below, twice a bar
//          → 2: tolls on every beat and answers itself on the half-beat
// (from step 1 the left hand also rolls the chord in sixteenths over a held octave, and
// from the peak the three canon lines quicken by themselves: they replay a lead that runs)
export const MYTHIC_VOICES = ['vln', 'c2', 'harp', 'cel', 'alto', 'c3', 'desc', 'echo', 'vln2', 'c4', 'tenor'];
const MYTHIC_STRINGS = new Set(['vln', 'cel', 'desc', 'vln2']);
// Balance at the peak. The extra piano voices share their level out (see next()), which
// alone would leave the two voices that live in the top octave too faint to hear over
// everything below them, so those two get some of it back; and the left hand, which
// rolls through deep octaves there, gives way a little as the voices gather.
const MYTHIC_LIFT = { echo: 1.5, c4: 1.5 };
const MYTHIC_LH_YIELD = 0.048; // per extra piano voice: about a quarter lighter under all seven

// Join repeated notes of a string line into one long bow.
function legato(notes) {
  const out = [];
  for (const x of notes) {
    const last = out[out.length - 1];
    if (last && last.m === x.m && Math.abs(last.t + last.d - x.t) < 1e-6) last.d += x.d;
    else out.push({ ...x });
  }
  return out;
}

// Where each key can go, and how the change is prepared.
//  lift: ♭VI – ♭VII – I of the new key;  dom: IV – V7 – I of the new key.
const ROUTES = {
  2: [{ to: 3, how: 'lift' }, { to: 7, how: 'dom' }, { to: 10, how: 'dom' }], // D → E♭, G, B♭
  3: [{ to: 5, how: 'lift' }, { to: 2, how: 'dom' }], // E♭ → F, D
  5: [{ to: 2, how: 'dom' }], // F → D
  7: [{ to: 2, how: 'dom' }], // G → D
  10: [{ to: 2, how: 'dom' }], // B♭ → D
};
const MAX_AWAY_SEC = 9 * 60; // always home to D within ~10 min

export class CanonEngine {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1;
    this.rng = makeRng(this.seed);
    this.mode = opts.mode in MODES ? opts.mode : 'calm';
    this.strings = opts.strings ?? true;
    this.canon = opts.canon ?? true;
    this.stayInD = opts.stayInD ?? false;
    this.backing = opts.backing ?? false;
    this.bpm = opts.bpm ?? MODES[this.mode].bpm;

    this.index = 0;
    this.key = HOME;
    this.awayCycles = 0;
    this.lo = MODES[this.mode].lo;
    this.hi = MODES[this.mode].hi;
    this.phase = this.rng.range(0, Math.PI * 2);
    this.energy = this.lo;
    this.sinceFamous = 0;
    this.history = []; // previous cycles' main right-hand lines (for the canon)
    this.lastSig = '';
    this.lastSkel = null;
    this.nextModAt = this._modGap();
    this.stringsRest = 0;
  }

  setMode(mode) { if (mode in MODES) this.mode = mode; }
  setOptions(o) { Object.assign(this, o); }

  get cycleSec() { return (8 * 60) / this.bpm; }

  _modGap() {
    const [a, b] = MODES[this.mode].modEvery;
    return this.index + this.rng.int(a, b);
  }

  // Energy: slow sine wave inside the mode's range + a little drift.
  _advanceEnergy() {
    const m = MODES[this.mode];
    // crossfade bounds toward the mode (1 step per cycle, never a jolt)
    this.lo += Math.sign(m.lo - this.lo) * Math.min(1, Math.abs(m.lo - this.lo));
    this.hi += Math.sign(m.hi - this.hi) * Math.min(1, Math.abs(m.hi - this.hi));
    const waveCycles = (this.rng.range(m.waveMin[0], m.waveMin[1]) * 60) / this.cycleSec;
    this.phase += (Math.PI * 2) / waveCycles;
    const mid = (this.lo + this.hi) / 2;
    const amp = (this.hi - this.lo) / 2;
    const target = mid - amp * Math.cos(this.phase) + this.rng.range(-0.35, 0.35);
    // the opening always starts quiet
    const ramp = Math.min(1, this.index / 6);
    const e = this.lo + (target - this.lo) * ramp;
    this.energy = Math.max(this.lo, Math.min(this.hi, e));
    return Math.max(1, Math.min(5, Math.round(this.energy)));
  }

  // Decide whether this cycle ends with a prepared key change.
  _planModulation() {
    if (this.index === 0) return null;
    const maxAway = Math.ceil(MAX_AWAY_SEC / this.cycleSec);
    if (this.stayInD) return this.key === HOME ? null : this._route(HOME);
    if (this.key !== HOME && this.awayCycles >= maxAway) return this._route(HOME);
    if (this.index < this.nextModAt) return null;
    const options = ROUTES[this.key] || [{ to: HOME, how: 'dom' }];
    let choice = this.rng.pick(options);
    // after a long time away, prefer going home
    if (this.key !== HOME && this.awayCycles > maxAway / 2) choice = options.find((r) => r.to === HOME) || choice;
    return choice;
  }

  _route(to) {
    const r = (ROUTES[this.key] || []).find((x) => x.to === to);
    return r || { to, how: 'dom' };
  }

  // The 8 chords of this cycle (with pivot chords on beats 6–7 when modulating).
  _chords(mod) {
    const chords = [];
    for (let b = 0; b < 8; b++) chords.push(diatonicChord(this.key, b));
    if (mod) {
      const t = mod.to;
      if (mod.how === 'lift') {
        chords[6] = pivotChord(t + 8, 'maj'); // ♭VI
        chords[7] = pivotChord(t + 10, 'maj'); // ♭VII
      } else {
        chords[6] = pivotChord(t + 5, 'maj'); // IV
        chords[7] = pivotChord(t + 7, 'dom7'); // V7
      }
    }
    return chords;
  }

  _bassLine(chords, mod) {
    const tonic = tonicMidi(this.key);
    let base = tonic - 12;
    if (base < 46) base += 12;
    const bass = GROUND.map((d) => degToMidi(base, d));
    if (mod) {
      for (const b of [6, 7]) {
        let m = bass[b - 1];
        // nearest root to the previous bass note, kept in the piano's low register
        let best = null;
        for (let c = 31; c <= 52; c++) {
          if (mod12(c) !== chords[b].rootPc) continue;
          if (best === null || Math.abs(c - m) < Math.abs(best - m)) best = c;
        }
        bass[b] = best;
      }
    }
    return bass;
  }

  _skeleton(chords, level, forceFamous) {
    const tonic = tonicMidi(this.key);
    const melTonic = tonic + 12;
    const lo = tonic + 2;
    const hi = tonic + 22;
    const r = this.rng;
    let type;
    if (forceFamous) type = 'famous';
    else if (MODES[this.mode].mythic) type = r.weighted(['famous', 'descent', 'walk', 'walk'], (t) => (t === 'famous' ? 0.24 : t === 'descent' ? 0.16 : 0.3));
    else type = r.weighted(['famous', 'descent', 'walk', 'walk'], (t) => (t === 'famous' ? 0.18 : t === 'descent' ? 0.17 : 0.33));

    let notes;
    if (type === 'famous' || type === 'descent') {
      const degs = type === 'famous' ? FAMOUS : DESCENT;
      const shift = level <= 1 && r.chance(0.4) ? -7 : 0; // warmer, lower in the quietest moments
      notes = degs.map((d) => degToMidi(melTonic, d + shift));
    } else {
      notes = [];
      let prev = this.lastSkel ? this.lastSkel[7] : degToMidi(melTonic, 2);
      // Mythical: the walk follows an arch, climbing to one peak and settling again.
      // The arch stands taller the higher the energy, so the climax also sings highest.
      let arch = null;
      if (MODES[this.mode].mythic) {
        type = 'arch';
        const peak = r.pick([3, 4, 4, 5]);
        const floor = lo + 2 + (this.energy - 2) * 1.2;
        const height = 5 + (this.energy - 2) * 2.8;
        arch = (b) => floor + height * (b <= peak ? Math.sin((Math.PI / 2) * (b / peak)) : Math.cos((Math.PI / 2) * ((b - peak) / (8 - peak))) ** 0.8);
      }
      for (let b = 0; b < 8; b++) {
        const cands = chordTonesIn(chords[b].pcs, lo, hi);
        const m = r.weighted(cands, (c) => {
          const d = Math.abs(c - prev);
          const pull = arch ? Math.exp(-Math.abs(c - arch(b)) / 3) : 1;
          if (d === 0) return 0.25 * pull;
          if (d <= 2) return 3 * pull;
          if (d <= 5) return 2 * pull;
          if (d <= 9) return 0.6 * pull;
          return 0.1 * pull;
        });
        notes.push(m);
        prev = m;
      }
    }
    // pivot beats: snap to their chord
    for (let b = 0; b < 8; b++) {
      if (!chords[b].diatonic) notes[b] = nearestChordTone(notes[b], chords[b].pcs);
    }
    return { type, notes };
  }

  _pickFigures(level, famous) {
    const m = MODES[this.mode];
    // Mythical keeps sixteenths for its peak, so its singing figures stretch over more
    // levels (f.myth); at the peak the running figures are the likelier choice
    const min = (f) => (m.mythic && f.myth ? f.myth[0] : f.min);
    const max = (f) => (m.mythic && f.myth ? f.myth[1] : f.max);
    const allow16 = m.allow16 || (m.peak16 && level >= m.peak16);
    const ok = FIGURES.filter((f) =>
      (m.mythic || !f.mythOnly) && level >= min(f) && level <= max(f) && (allow16 || !f.s16) && (!famous || f.keepsContour));
    const pool = ok.length ? ok : FIGURES.filter((f) => f.name === 'quarter');
    const weight = (f) => (f.name === 'half' ? 0.5 : 1) + (level === max(f) ? 0.6 : 0) + (f.s16 && level >= 5 ? 0.8 : 0) + (f.s16 && m.mythic ? 1.2 : 0);
    const a = this.rng.weighted(pool, weight);
    const b = this.rng.chance(m.mix) ? this.rng.weighted(pool, weight) : a;
    return [a, b];
  }

  _leftHand(bass, chords, level) {
    const r = this.rng;
    // Mythical keeps the bass deep and solemn: octaves instead of busy broken chords,
    // until the climb to the peak, where the left hand rolls the whole chord over a held octave
    const myth = MODES[this.mode].mythic;
    const style = level <= 1 ? 'ground'
      : level === 2 ? r.pick(['ground', 'rolled', 'octave'])
      : myth && this._surge() >= 1 ? r.pick(['grand', 'grand', 'octaveBroken'])
      : myth ? (level === 3 ? r.pick(['rolled', 'octave', 'broken']) : r.pick(['octaveBroken', 'octave', 'octaveBroken']))
      : level === 3 ? r.pick(['broken', 'rolled', 'broken'])
      : r.pick(['broken', 'broken', 'octaveBroken']);
    const out = [];
    for (let b = 0; b < 8; b++) {
      const m = bass[b];
      const pcs = chords[b].pcs;
      const fifth = chordToneAbove(chordToneAbove(m, pcs), pcs);
      const tenth = chordToneAbove(fifth, pcs);
      const accent = b % 2 === 0 ? 1 : 0.9;
      switch (style) {
        case 'ground':
          out.push({ t: b, d: 0.98, m, v: 0.85 * accent });
          break;
        case 'octave':
          out.push({ t: b, d: 0.98, m, v: 0.85 * accent });
          if (m - 12 >= 28) out.push({ t: b, d: 0.98, m: m - 12, v: 0.6 * accent });
          break;
        case 'rolled':
          out.push({ t: b, d: 0.98, m, v: 0.85 * accent });
          out.push({ t: b + 0.08, d: 0.88, m: fifth, v: 0.55 });
          out.push({ t: b + 0.16, d: 0.8, m: tenth, v: 0.5 });
          break;
        case 'broken':
        case 'octaveBroken':
          out.push({ t: b, d: 0.5, m, v: 0.85 * accent });
          if (style === 'octaveBroken' && m - 12 >= 28) out.push({ t: b, d: 0.5, m: m - 12, v: 0.6 });
          out.push({ t: b + 0.5, d: 0.5, m: b % 2 === 0 ? fifth : tenth, v: 0.55 });
          break;
        case 'grand':
          out.push({ t: b, d: 0.98, m, v: 0.85 * accent });
          if (m - 12 >= 28) out.push({ t: b, d: 0.98, m: m - 12, v: 0.6 });
          out.push({ t: b + 0.25, d: 0.25, m: fifth, v: 0.48 });
          out.push({ t: b + 0.5, d: 0.25, m: tenth, v: 0.55 });
          out.push({ t: b + 0.75, d: 0.25, m: fifth, v: 0.48 });
          break;
      }
    }
    return { style, notes: out };
  }

  _renderRight(skel, chords, figs) {
    const out = [];
    for (let b = 0; b < 8; b++) {
      const fig = figs[Math.floor(b / 2) % 2];
      const cur = skel.notes[b];
      const next = b < 7 ? skel.notes[b + 1] : skel.notes[b];
      const notes = fig.render({ cur, next, chord: chords[b], beat: b, keyPc: this.key });
      for (const x of notes) out.push({ t: b + x.t, d: x.d, m: x.m, v: x.v });
    }
    return out;
  }

  // Canon voice: an earlier cycle's line, moved into the current key, minus clashes.
  _canonVoice(source, against, chords, octave, mod, velScale) {
    if (!source) return [];
    const shift = tonicMidi(this.key) - source.tonic + octave;
    const out = [];
    for (const x of source.notes) {
      const b = Math.floor(x.t);
      if (source.pivotBeats.includes(b)) continue; // its pivot chords don't fit here
      if (mod && b >= 6) continue; // leave our own pivots clean
      const m = x.m + shift;
      if (m < 52 || m > 96) continue;
      const strong = Math.abs(x.t - Math.round(x.t)) < 1e-6 || Math.abs(x.t % 1 - 0.5) < 1e-6;
      if (strong && against.some((y) => y.t <= x.t + 1e-6 && x.t < y.t + y.d - 1e-6 && isSemitoneClash(y.m, m))) continue;
      if (against.some((y) => y.m === m && Math.abs(y.t - x.t) < 1e-6)) continue; // no unison doubling
      out.push({ t: x.t, d: x.d, m, v: x.v * velScale });
    }
    return out;
  }

  // How far Mythical is up its last climb: 0 below it, 1–3 for the surge steps passed.
  _surge() {
    return (MODES[this.mode].surge || []).filter((x) => this.energy >= x).length;
  }

  // Which of Mythical's eleven extra voices are in, at the current energy.
  _mythicActive() {
    const at = MODES[this.mode].voiceAt;
    return new Set(MYTHIC_VOICES.filter((v, i) =>
      this.energy >= at[i] && (MYTHIC_STRINGS.has(v) ? this.strings : this.canon)));
  }

  // Mythical's piano voices. Three are true canon lines; the other four are cut from
  // the current melody (its harmony, its lower octave, its echo, its harp roll). Every
  // voice is checked against all the ones before it: no strong-beat semitone clashes,
  // and never the same key struck twice at once. On the climb to the peak the four
  // cut voices quicken step by step (surge 1–3, see MYTHIC_VOICES).
  _mythicPiano(active, rh, lh, skel, chords, mod, surge) {
    const parts = {};
    const sounding = rh.slice();
    const struck = rh.concat(lh);
    const add = (voice, notes) => {
      parts[voice] = notes;
      for (const x of notes) { sounding.push(x); struck.push(x); }
    };
    // is this key already being struck (within a rolled chord's width; the peak's
    // thirty-seconds pass w = 0.1 so a key is free again one thirty-second later)?
    const taken = (t, m, w = 0.2) => struck.some((y) => y.m === m && Math.abs(y.t - t) < w);
    const fits = (x, w) => {
      if (x.m < 48 || x.m > 96 || taken(x.t, x.m, w)) return false;
      const strong = Math.abs(x.t * 2 - Math.round(x.t * 2)) < 1e-6;
      return !(strong && sounding.some((y) => y.t <= x.t + 1e-6 && x.t < y.t + y.d - 1e-6 && isSemitoneClash(y.m, x.m)));
    };
    const cut = (voice, notes, w) => add(voice, notes.filter((x) => fits(x, w)));
    const s = skel.notes;
    const beats = [0, 1, 2, 3, 4, 5, 6, 7];
    // the nearest chord tone at or under m that nobody else is striking at t
    const freeUnder = (t, m, pcs) => {
      let c = pcs.includes(mod12(m)) ? m : chordToneBelow(m, pcs);
      for (let i = 0; i < 2 && taken(t, c); i++) c = chordToneBelow(c, pcs);
      return c;
    };

    if (active.has('c2')) add('c2', this._canonVoice(this.history[0], sounding.concat(lh), chords, -12, mod, 0.58));
    if (active.has('c3')) add('c3', this._canonVoice(this.history[1], sounding.concat(lh), chords, 0, mod, 0.46));
    if (active.has('c4')) add('c4', this._canonVoice(this.history[2], sounding.concat(lh), chords, 12, mod, 0.38));
    // the n chord tones under m, nearest first
    const under = (m, pcs, n) => {
      const out = [];
      for (let c = m; out.length < n;) out.push(c = chordToneBelow(c, pcs));
      return out;
    };
    if (active.has('alto') && surge >= 1) {
      // the lead's top line, a third below: under a chord tone the next chord tone down,
      // under a passing note the scale note a third down, so runs go in parallel
      const top = new Map();
      for (const x of rh) { const k = x.t.toFixed(4); if (!top.has(k) || top.get(k).m < x.m) top.set(k, x); }
      cut('alto', [...top.values()].map((x) => {
        const ch = chords[Math.floor(x.t)];
        const m = ch.pcs.includes(mod12(x.m)) ? chordToneBelow(x.m, ch.pcs) : scaleStep(x.m, -2, ch.scale);
        return { t: x.t, d: x.d, m, v: x.t % 1 < 1e-6 ? 0.5 : 0.4 };
      }));
    } else if (active.has('alto')) {
      cut('alto', beats.map((b) => ({ t: b, d: 0.98, m: freeUnder(b, chordToneBelow(s[b], chords[b].pcs), chords[b].pcs), v: 0.5 })));
    }
    if (active.has('tenor') && surge >= 2) {
      cut('tenor', beats.flatMap((b) => {
        const m = freeUnder(b, s[b] - 12, chords[b].pcs);
        return [{ t: b, d: 0.5, m, v: 0.5 }, { t: b + 0.5, d: 0.5, m: chordToneBelow(m, chords[b].pcs), v: 0.38 }];
      }));
    } else if (active.has('tenor')) {
      cut('tenor', beats.filter((b) => b % 2 === 0).map((b) => ({ t: b, d: 0.98, m: freeUnder(b, s[b] - 12, chords[b].pcs), v: 0.5 })));
    }
    if (active.has('echo') && surge >= 1) {
      // a peal between the beats on the three chord tones from the melody's upper
      // octave down: falling first on even beats, rising first on odd ones, so the
      // bells always move against the harp. Three sixteenths, then seven thirty-seconds.
      const fast = surge >= 3;
      const notes = [];
      for (const b of beats) {
        const a = [s[b] + 12, ...under(s[b] + 12, chords[b].pcs, 2)];
        const peal = (fast ? [0, 1, 2, 1, 0, 1, 2] : [0, 1, 2]).map((j) => (b % 2 === 0 ? j : 2 - j));
        peal.forEach((j, i) => notes.push({ t: b + (fast ? 0.125 : 0.25) * (i + 1), d: 0.5, m: a[j], v: j === 0 ? 0.36 : fast ? 0.28 : 0.32 }));
      }
      cut('echo', notes, fast ? 0.1 : undefined);
    } else if (active.has('echo')) {
      cut('echo', beats.map((b) => ({ t: b + 0.5, d: 0.5, m: s[b] + 12, v: 0.4 })));
    }
    if (active.has('harp')) {
      const notes = [];
      for (const b of beats) {
        const pcs = chords[b].pcs;
        const up = b % 2 === 0; // up one beat, down the next
        if (surge >= 2) {
          // seven thirty-seconds between the beats: the five chord tones under the
          // melody note, swept through and turned back
          const h = under(s[b], pcs, 5);
          const sweep = up ? [4, 3, 2, 1, 0, 1, 2] : [0, 1, 2, 3, 4, 3, 2];
          sweep.forEach((j, i) => notes.push({ t: b + 0.125 * (i + 1), d: 0.5, m: h[j], v: 0.3 + 0.012 * (up ? i : 6 - i) }));
        } else {
          const [hi, mid, low] = under(s[b], pcs, 3);
          const wave = up ? [low, mid, hi] : [hi, mid, low];
          wave.forEach((m, i) => notes.push({ t: b + 0.25 * (i + 1), d: 0.5, m, v: 0.4 + 0.04 * (up ? i : 2 - i) }));
        }
      }
      cut('harp', notes, surge >= 2 ? 0.1 : undefined);
    }
    return parts;
  }

  // Mythical's four singing string voices (the pad and the bass cello stay accompaniment).
  _mythicStrings(active, skel, chords, mod, base) {
    const parts = {};
    const s = skel.notes;
    const melTonic = tonicMidi(this.key) + 12;
    const upTo = mod ? 6 : 8;
    const line = (voice, inst, v, pitch, end = 8) => {
      const notes = [];
      for (let b = 0; b < end; b++) {
        const m = pitch(b);
        if (m != null) notes.push({ t: b, d: 1, m, v, inst, voice });
      }
      parts[voice] = legato(notes);
    };
    if (active.has('vln')) line('vln', 'violin', base + 0.12, (b) => s[b]);
    if (active.has('desc')) {
      // the famous line when the lead is off elsewhere; Pachelbel's descent, a sixth
      // above, when the lead has the famous line itself
      const theme = skel.type === 'famous' ? (b) => degToMidi(melTonic + 12, DESCENT[b]) : (b) => degToMidi(melTonic, FAMOUS[b]);
      // (where the first violins already hold the same note, they carry the line)
      line('desc', 'violin', base + 0.07, (b) => (theme(b) === s[b] && active.has('vln') ? null : theme(b)), upTo);
    }
    if (active.has('vln2')) {
      const held = (b) => (parts.desc || []).filter((x) => x.t <= b && b < x.t + x.d).map((x) => x.m);
      line('vln2', 'violin', base + 0.03, (b) => {
        // an open sixth or so under the melody, a third when the descant has that note
        const pcs = chords[b].pcs;
        const third = chordToneBelow(s[b], pcs);
        const sixth = chordToneBelow(third, pcs);
        return [sixth, third, chordToneBelow(sixth, pcs)].find((m) => m >= 55 && !held(b).includes(m)) ?? null;
      });
    }
    const src = this.history[0];
    if (active.has('cel') && src) {
      const shift = tonicMidi(this.key) - src.tonic - 12;
      line('cel', 'cello', base + 0.1, (b) => {
        if (src.pivotBeats.includes(b)) return null;
        let m = src.skel[b] + shift;
        while (m > 69) m -= 12;
        return chords[b].pcs.includes(mod12(m)) ? m : null;
      }, upTo);
    }
    return parts;
  }

  _strings(chords, bass, level, mod, skel, active) {
    const m = MODES[this.mode];
    const out = [];
    if (!this.strings || level < 2) return out;
    if (this.stringsRest > 0) { this.stringsRest--; return out; }
    // (Mythical lets the strings rest only while the music is still quiet)
    if (this.rng.chance(0.08) && !(m.mythic && this.energy >= 3.4)) { this.stringsRest = this.rng.int(1, 2); }

    const base = m.mythic ? 0.27 : m.violins ? 0.32 : 0.22;
    const sung = m.mythic ? this._mythicStrings(active, skel, chords, mod, base) : null;
    const taken = (b) => (sung ? Object.values(sung).flat().filter((x) => x.inst === 'violin' && x.t <= b && b < x.t + x.d).map((x) => x.m) : []);
    // pad: two inner chord tones per beat, held across repeated notes
    let prev = [nearestChordTone(62, chords[0].pcs), nearestChordTone(67, chords[0].pcs)];
    for (let b = 0; b < 8; b++) {
      const pcs = chords[b].pcs;
      let cands = chordTonesIn(pcs, 57, 74).filter((c) => mod12(c) !== chords[b].rootPc || pcs.length > 3);
      // keep the pad off the notes the singing violins hold
      const free = cands.filter((c) => !taken(b).includes(c));
      if (free.length >= 2) cands = free;
      const pick = (target) => cands.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best), cands[0]);
      const a = pick(prev[0]);
      let c2 = pick(prev[1]);
      if (c2 === a) c2 = chordToneAbove(a, pcs);
      const swell = mod ? 1 + b * 0.05 : 1;
      for (const note of [a, c2]) {
        const last = out.find((o) => o.voice === 'pad' && o.m === note && Math.abs(o.t + o.d - b) < 0.05);
        if (last) last.d += 1;
        else out.push({ t: b, d: 1, m: note, v: base * swell, inst: 'violin', voice: 'pad' });
      }
      prev = [a, c2];
    }
    // cello doubles the ground an octave below
    if (level >= 3 && !this.backing) {
      for (let b = 0; b < 8; b++) {
        let note = bass[b] - 12;
        if (note < 36) note += 12;
        out.push({ t: b, d: 1, m: note, v: base + 0.08, inst: 'cello', voice: 'bass' });
      }
    }
    // violins sing the famous line in Bright peaks
    const melTonic = tonicMidi(this.key) + 12;
    if (sung) {
      for (const part of Object.values(sung)) out.push(...part);
    } else if (m.violins && level >= 4) {
      for (let b = 0; b < (mod ? 6 : 8); b++) {
        out.push({ t: b, d: 1, m: degToMidi(melTonic, FAMOUS[b]), v: base + 0.12, inst: 'violin', voice: 'vln' });
      }
    } else if (m.counter && level >= 3) {
      // Masterpiece: Pachelbel's descending line as a singing half-note counter-melody
      for (let b = 0; b < (mod ? 6 : 8); b += 2) {
        out.push({ t: b, d: 2, m: degToMidi(melTonic, DESCENT[b]), v: base + 0.1, inst: 'violin', voice: 'vln' });
      }
    }
    return out;
  }

  next() {
    const r = this.rng;
    const m = MODES[this.mode];
    const level = this._advanceEnergy();
    const mod = this._planModulation();
    const chords = this._chords(mod);
    const bass = this._bassLine(chords, mod);

    const maxGapCycles = Math.max(4, Math.floor(110 / this.cycleSec));
    const forceFamous = this.index === 0 || this.sinceFamous >= maxGapCycles;

    // right hand (retry if identical to the previous cycle)
    let skel, figs, rh, sig;
    for (let tries = 0; tries < 8; tries++) {
      skel = this._skeleton(chords, level, forceFamous);
      figs = this.index === 0 ? [FIGURES.find((f) => f.name === 'quarter'), FIGURES.find((f) => f.name === 'quarter')] : this._pickFigures(level, skel.type === 'famous');
      rh = this._renderRight(skel, chords, figs);
      sig = rh.map((x) => `${x.t.toFixed(2)}:${x.m}`).join(',');
      if (sig !== this.lastSig) break;
    }
    this.lastSig = sig;
    this.lastSkel = skel.notes;
    this.sinceFamous = skel.type === 'famous' ? 0 : this.sinceFamous + 1;

    const lh = this._leftHand(bass, chords, level);

    // canon voices
    const voices = !this.canon ? 1 : 1 + m.voiceAt.filter((x) => this.energy >= x).length;
    const nVoices = Math.min(voices, m.maxVoices);
    let c2 = [];
    let c3 = [];
    let c4 = [];
    let c5 = [];
    let c6 = [];
    // Mythical builds its own twelve; the other modes stack canon replays
    const active = m.mythic ? this._mythicActive() : null;
    const mythic = m.mythic ? this._mythicPiano(active, rh, lh.notes, skel, chords, mod, this._surge()) : null;
    if (!mythic) {
      if (nVoices >= 2) c2 = this._canonVoice(this.history[0], rh, chords, -12, mod, 0.62);
      if (nVoices >= 3) c3 = this._canonVoice(this.history[1], rh.concat(c2), chords, 0, mod, 0.5);
      if (nVoices >= 4) c4 = this._canonVoice(this.history[2], rh.concat(c2, c3), chords, 12, mod, 0.42);
      if (nVoices >= 5) c5 = this._canonVoice(this.history[3], rh.concat(c2, c3, c4), chords, -12, mod, 0.36);
      if (nVoices >= 6) c6 = this._canonVoice(this.history[4], rh.concat(c2, c3, c4, c5), chords, 12, mod, 0.32);
    }

    // optional backing track: the Canon's bassline on cello, one octave above the
    // piano's left hand (so it is heard as its own part, even on laptop speakers),
    // plus a deep sub-octave underneath for headphones. Calm sings it in legato
    // quarters; the other modes drive it in eighths like a pop-style backing.
    const backing = [];
    if (this.backing) {
      const e = this.energy;
      for (let b = 0; b < 8; b++) {
        const mid = bass[b] + 12 <= 64 ? bass[b] + 12 : bass[b];
        if (this.mode === 'calm' || m.mythic) {
          backing.push({ t: b, d: 1, m: mid, v: 0.6 + 0.05 * e, inst: 'backing', voice: 'backing' });
        } else {
          backing.push({ t: b, d: 0.5, m: mid, v: 0.68 + 0.05 * e, inst: 'backing', voice: 'backing' });
          backing.push({ t: b + 0.5, d: 0.5, m: mid, v: 0.5 + 0.04 * e, inst: 'backing', voice: 'backing' });
        }
        if (bass[b] - 12 >= 24) backing.push({ t: b, d: 1, m: bass[b] - 12, v: 0.5 + 0.04 * e, inst: 'backing', voice: 'backing' });
      }
    }


    const strings = this._strings(chords, bass, level, mod, skel, active);

    // tempo shaping: beat length multipliers (phrase-end ritardando, breath before a key change)
    const beats = new Array(8).fill(1).map(() => (this.mode === 'calm' || m.mythic ? 1 + r.range(-0.025, 0.025) : 1 + r.range(-0.012, 0.012)));
    if (this.index % 4 === 3) beats[7] *= 1.15;
    if (mod) { beats[6] *= 1.1; beats[7] *= 1.4; }

    // energy → loudness
    const vel = 0.3 + 0.09 * this.energy;
    const notes = [];
    const push = (arr, inst, voice, gain) => {
      for (const x of arr) {
        notes.push({
          t: x.t, d: x.d, m: x.m,
          v: Math.min(1, x.v * vel * gain * (x.t % 2 < 1e-6 ? 1.06 : 1)),
          inst: x.inst || inst, voice: x.voice || voice,
          hum: r.range(-0.01, 0.01),
        });
      }
    };
    push(rh, 'piano', 'rh', 1.05);
    // with the backing on, the cello takes over any left-hand note it would double
    const backKey = new Set(backing.map((x) => `${x.t}:${x.m}`));
    const extra = mythic ? Object.keys(mythic).length : 0;
    push(backing.length ? lh.notes.filter((x) => !backKey.has(`${x.t}:${x.m}`)) : lh.notes, 'piano', 'lh', 0.85 / (1 + MYTHIC_LH_YIELD * extra));
    push(c2, 'piano', 'c2', 1);
    push(c3, 'piano', 'c3', 1);
    push(c4, 'piano', 'c4', 1);
    push(c5, 'piano', 'c5', 1);
    push(c6, 'piano', 'c6', 1);
    if (mythic) {
      // the more piano voices, the lighter each one plays, so the peak is wide rather than loud
      const trim = 1 / (1 + 0.1 * extra);
      for (const [voice, part] of Object.entries(mythic)) push(part, 'piano', voice, trim * (MYTHIC_LIFT[voice] || 1));
    }
    for (const x of backing) notes.push({ ...x, v: Math.min(1, x.v), hum: r.range(-0.008, 0.008) });
    // (in Mythical the string section shares its level out as more of it sings)
    const sTrim = mythic ? 1 / (1 + 0.12 * MYTHIC_VOICES.filter((v) => MYTHIC_STRINGS.has(v) && strings.some((x) => x.voice === v)).length) : 1;
    for (const s of strings) notes.push({ ...s, v: Math.min(1, s.v * (0.7 + 0.1 * this.energy) * sTrim), hum: r.range(-0.015, 0.015) });

    const cycle = {
      index: this.index,
      key: this.key,
      keyName: KEY_NAMES[this.key],
      mode: this.mode,
      energy: this.energy,
      level,
      voices: 1 + [c2, c3, c4, c5, c6].filter((c) => c.length).length
        + (mythic ? MYTHIC_VOICES.filter((v) => (mythic[v] || strings.filter((x) => x.voice === v)).length).length : 0),
      famous: skel.type === 'famous',
      skeleton: skel.type,
      figures: figs.map((f) => f.name),
      leftHand: lh.style,
      transition: mod ? { to: mod.to, toName: KEY_NAMES[mod.to], how: mod.how } : null,
      chords: chords.map((c) => c.pcs),
      bass,
      beats,
      notes,
    };

    // remember this line for the canon
    this.history.unshift({ notes: rh, skel: skel.notes, tonic: tonicMidi(this.key), pivotBeats: mod ? [6, 7] : [] });
    this.history.length = Math.min(this.history.length, 5);

    // advance key
    if (mod) {
      this.key = mod.to;
      this.nextModAt = this._modGap() + 1;
    }
    this.awayCycles = this.key === HOME ? 0 : this.awayCycles + 1;
    this.index++;
    return cycle;
  }
}

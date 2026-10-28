// The endless Canon engine. Pure JS, no audio: each call to next() returns one
// cycle (2 bars = 8 chords = 8 beats) of note events. Same seed → same music.
import { makeRng } from './rng.js?v=7';
import {
  HOME, KEY_NAMES, GROUND, FAMOUS, DESCENT, mod12, tonicMidi, degToMidi,
  diatonicChord, pivotChord, nearestChordTone, chordTonesIn, chordToneAbove,
  chordToneBelow, isSemitoneClash,
} from './theory.js?v=7';
import { FIGURES } from './patterns.js?v=7';

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
};

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
    else type = r.weighted(['famous', 'descent', 'walk', 'walk'], (t) => (t === 'famous' ? 0.18 : t === 'descent' ? 0.17 : 0.33));

    let notes;
    if (type === 'famous' || type === 'descent') {
      const degs = type === 'famous' ? FAMOUS : DESCENT;
      const shift = level <= 1 && r.chance(0.4) ? -7 : 0; // warmer, lower in the quietest moments
      notes = degs.map((d) => degToMidi(melTonic, d + shift));
    } else {
      notes = [];
      let prev = this.lastSkel ? this.lastSkel[7] : degToMidi(melTonic, 2);
      for (let b = 0; b < 8; b++) {
        const cands = chordTonesIn(chords[b].pcs, lo, hi);
        const m = r.weighted(cands, (c) => {
          const d = Math.abs(c - prev);
          if (d === 0) return 0.25;
          if (d <= 2) return 3;
          if (d <= 5) return 2;
          if (d <= 9) return 0.6;
          return 0.1;
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
    const ok = FIGURES.filter((f) =>
      level >= f.min && level <= f.max + 0 && (m.allow16 || !f.s16) && (!famous || f.keepsContour));
    const pool = ok.length ? ok : FIGURES.filter((f) => f.name === 'quarter');
    const weight = (f) => (f.name === 'half' ? 0.5 : 1) + (level === f.max ? 0.6 : 0) + (f.s16 && level >= 5 ? 0.8 : 0);
    const a = this.rng.weighted(pool, weight);
    const b = this.rng.chance(m.mix) ? this.rng.weighted(pool, weight) : a;
    return [a, b];
  }

  _leftHand(bass, chords, level) {
    const r = this.rng;
    const style = level <= 1 ? 'ground'
      : level === 2 ? r.pick(['ground', 'rolled', 'octave'])
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

  _strings(chords, bass, level, mod, skel) {
    const m = MODES[this.mode];
    const out = [];
    if (!this.strings || level < 2) return out;
    if (this.stringsRest > 0) { this.stringsRest--; return out; }
    if (this.rng.chance(0.08)) { this.stringsRest = this.rng.int(1, 2); }

    const base = m.violins ? 0.32 : 0.22;
    // pad: two inner chord tones per beat, held across repeated notes
    let prev = [nearestChordTone(62, chords[0].pcs), nearestChordTone(67, chords[0].pcs)];
    for (let b = 0; b < 8; b++) {
      const pcs = chords[b].pcs;
      const cands = chordTonesIn(pcs, 57, 74).filter((c) => mod12(c) !== chords[b].rootPc || pcs.length > 3);
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
    if (m.violins && level >= 4) {
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
    if (nVoices >= 2) c2 = this._canonVoice(this.history[0], rh, chords, -12, mod, 0.62);
    if (nVoices >= 3) c3 = this._canonVoice(this.history[1], rh.concat(c2), chords, 0, mod, 0.5);
    if (nVoices >= 4) c4 = this._canonVoice(this.history[2], rh.concat(c2, c3), chords, 12, mod, 0.42);
    if (nVoices >= 5) c5 = this._canonVoice(this.history[3], rh.concat(c2, c3, c4), chords, -12, mod, 0.36);
    if (nVoices >= 6) c6 = this._canonVoice(this.history[4], rh.concat(c2, c3, c4, c5), chords, 12, mod, 0.32);

    // optional backing track: the Canon's bassline on cello, every cycle, legato
    const backing = [];
    if (this.backing) {
      for (let b = 0; b < 8; b++) {
        backing.push({ t: b, d: 1, m: bass[b], v: 0.62 + 0.04 * this.energy, inst: 'backing', voice: 'backing' });
        let low = bass[b] - 12;
        if (low >= 36) backing.push({ t: b, d: 1, m: low, v: 0.45 + 0.03 * this.energy, inst: 'backing', voice: 'backing' });
      }
    }

    const strings = this._strings(chords, bass, level, mod, skel);

    // tempo shaping: beat length multipliers (phrase-end ritardando, breath before a key change)
    const beats = new Array(8).fill(1).map(() => (this.mode === 'calm' ? 1 + r.range(-0.025, 0.025) : 1 + r.range(-0.012, 0.012)));
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
    push(lh.notes, 'piano', 'lh', 0.85);
    push(c2, 'piano', 'c2', 1);
    push(c3, 'piano', 'c3', 1);
    push(c4, 'piano', 'c4', 1);
    push(c5, 'piano', 'c5', 1);
    push(c6, 'piano', 'c6', 1);
    for (const x of backing) notes.push({ ...x, v: Math.min(1, x.v), hum: r.range(-0.008, 0.008) });
    for (const s of strings) notes.push({ ...s, v: Math.min(1, s.v * (0.7 + 0.1 * this.energy)), hum: r.range(-0.015, 0.015) });

    const cycle = {
      index: this.index,
      key: this.key,
      keyName: KEY_NAMES[this.key],
      mode: this.mode,
      energy: this.energy,
      level,
      voices: 1 + [c2, c3, c4, c5, c6].filter((c) => c.length).length,
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
    this.history.unshift({ notes: rh, tonic: tonicMidi(this.key), pivotBeats: mod ? [6, 7] : [] });
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

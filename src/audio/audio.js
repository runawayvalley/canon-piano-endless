// Audio: sampled piano + soft strings (Tone.js), and a look-ahead scheduler that
// asks the engine for one cycle at a time and places every note on the audio clock.
/* global Tone */
import { NOTE_NAMES } from '../engine/theory.js';

const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const PIANO_NOTES = ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4',
  'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7'];
const VIOLIN_NOTES = ['G3', 'A3', 'B3', 'D4', 'Fs4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6'];
const CELLO_NOTES = ['C2', 'E2', 'G2', 'B2', 'D3', 'F3', 'A3', 'C4', 'E4', 'G4', 'B4'];

const toToneName = (n) => n.replace('s', '#');
const urlMap = (notes, file) => Object.fromEntries(notes.map((n) => [toToneName(n), file(n)]));
export const midiName = (m) => `${NOTE_NAMES[m % 12].replace('s', '#')}${Math.floor(m / 12) - 1}`;

export class CanonAudio {
  constructor(engine, { onCycle, onNote } = {}) {
    this.engine = engine;
    this.onCycle = onCycle || (() => {});
    this.onNote = onNote || (() => {});
    this.ready = false;
    this.stringsReady = false;
    this.playing = false;
    this.nextCycleTime = 0;
    this.timer = null;
    this.stringsVolume = 0.8;
    this.volume = 0.85;
  }

  async init(onProgress = () => {}) {
    await Tone.start();
    const ctx = Tone.getContext();
    ctx.lookAhead = 0.05;

    this.master = new Tone.Gain(this.volume);
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master.connect(this.limiter);
    this.reverb = new Tone.Reverb({ decay: 4.5, preDelay: 0.02, wet: 1 });
    await this.reverb.generate();
    this.reverbSend = new Tone.Gain(0.22).connect(this.reverb);
    this.reverb.connect(this.master);

    this.pianoBus = new Tone.Gain(1).connect(this.master);
    this.pianoBus.connect(this.reverbSend);
    this.stringBus = new Tone.Gain(this.stringsVolume).connect(this.master);
    this.stringSend = new Tone.Gain(0.5).connect(this.reverb);
    this.stringBus.connect(this.stringSend);

    onProgress('Loading piano…');
    this.piano = await loadSampler(urlMap(PIANO_NOTES, (n) => `${n}.mp3`), SALAMANDER, { release: 1.2 });
    this.piano.connect(this.pianoBus);
    this.ready = true;

    // strings load in the background so the first sound stays fast
    const base = new URL('../../samples/strings/', import.meta.url).href;
    Promise.all([
      loadSampler(urlMap(VIOLIN_NOTES, (n) => `violin_${n}.mp3`), base, { attack: 0.7, release: 1.8 }),
      loadSampler(urlMap(CELLO_NOTES, (n) => `cello_${n}.mp3`), base, { attack: 0.5, release: 1.6 }),
    ]).then(([violin, cello]) => {
      this.violin = violin; this.cello = cello;
      violin.connect(this.stringBus); cello.connect(this.stringBus);
      this.stringsReady = true;
    }).catch((e) => console.warn('strings failed to load', e));
  }

  get now() { return Tone.now(); }

  start() {
    if (!this.ready) return;
    const ctx = Tone.getContext().rawContext;
    if (ctx.state === 'suspended') ctx.resume();
    if (!this.nextCycleTime) this.nextCycleTime = this.now + 0.3;
    this.master.gain.cancelScheduledValues(this.now);
    this.master.gain.rampTo(this.volume, 0.3);
    this.playing = true;
    this._tick();
    this.timer = setInterval(() => this._tick(), 200);
  }

  // Pausing freezes the audio clock, so already-scheduled notes resume in place.
  async pause() {
    this.playing = false;
    clearInterval(this.timer);
    this.master.gain.rampTo(0, 0.15);
    await new Promise((r) => setTimeout(r, 180));
    await Tone.getContext().rawContext.suspend();
  }

  setVolume(v) { this.volume = v; if (this.playing) this.master.gain.rampTo(v, 0.1); }
  setStringsVolume(v) { this.stringsVolume = v; if (this.stringBus) this.stringBus.gain.rampTo(v, 0.2); }

  fadeOutAndPause(seconds = 20) {
    this.master.gain.rampTo(0, seconds);
    return new Promise((r) => setTimeout(async () => { await this.pause(); r(); }, seconds * 1000));
  }

  // keep about one cycle scheduled ahead of the clock
  _tick() {
    if (!this.playing) return;
    while (this.nextCycleTime - this.now < 2.5) this._scheduleCycle();
  }

  _scheduleCycle() {
    const cycle = this.engine.next();
    const spb = 60 / this.engine.bpm;
    const starts = [];
    let t = this.nextCycleTime;
    for (const mult of cycle.beats) { starts.push(t); t += spb * mult; }
    const end = t;
    const beatLen = (b) => spb * cycle.beats[Math.min(7, b)];
    const timeAt = (x) => {
      const b = Math.floor(x);
      return b >= 8 ? end + (x - 8) * spb : starts[b] + (x - b) * beatLen(b);
    };

    for (const n of cycle.notes) {
      const time = Math.max(this.now + 0.01, timeAt(n.t) + n.hum);
      const dur = Math.max(0.05, timeAt(n.t + n.d) - timeAt(n.t));
      const inst = n.inst === 'piano' ? this.piano : n.inst === 'violin' ? this.violin : this.cello;
      if (!inst) continue; // strings still loading
      // piano: a touch of pedal; strings: legato overlap
      const hold = n.inst === 'piano' ? dur * 1.15 : dur + 0.12;
      inst.triggerAttackRelease(midiName(n.m), hold, time, n.v);
      this.onNote({ ...n, time, dur });
    }
    this.onCycle({ ...cycle, startTime: this.nextCycleTime, endTime: end });
    this.nextCycleTime = end;
  }
}

function loadSampler(urls, baseUrl, opts) {
  return new Promise((resolve, reject) => {
    const s = new Tone.Sampler({ urls, baseUrl, ...opts, onload: () => resolve(s), onerror: reject });
  });
}

// Audio: sampled piano + soft strings (Tone.js), and a look-ahead scheduler that
// asks the engine for one cycle at a time and places every note on the audio clock.
/* global Tone */
import { NOTE_NAMES } from '../engine/theory.js?v=11';

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
    this.backingVolume = 0.8;
    this.volume = 0.85;
    this.queue = []; // notes generated but not yet handed to the samplers
    this.horizon = 4.5; // seconds of music generated ahead (lets the roll show notes falling in)
  }

  async init(onProgress = () => {}) {
    // 'playback' asks the browser for bigger audio buffers: a little more latency
    // (irrelevant for a generative stream) and far fewer crackles when the CPU is busy.
    Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.1 }));
    await Tone.start();

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
    // backing slider 0..1 maps to gain 0..1.6 so full volume clearly stands out
    this.backingBus = new Tone.Gain(this.backingVolume * 1.6).connect(this.master);
    this.backingSend = new Tone.Gain(0.25).connect(this.reverb);
    this.backingBus.connect(this.backingSend);

    onProgress('Loading piano…');
    this.piano = await loadSampler(urlMap(PIANO_NOTES, (n) => `${n}.mp3`), SALAMANDER, { release: 1.2 });
    this.piano.connect(this.pianoBus);
    this.ready = true;

    // strings load in the background so the first sound stays fast
    const base = new URL('../../samples/strings/', import.meta.url).href;
    Promise.all([
      loadSampler(urlMap(VIOLIN_NOTES, (n) => `violin_${n}.mp3`), base, { attack: 0.7, release: 1.8 }),
      loadSampler(urlMap(CELLO_NOTES, (n) => `cello_${n}.mp3`), base, { attack: 0.5, release: 1.6 }),
      loadSampler(urlMap(CELLO_NOTES, (n) => `cello_${n}.mp3`), base, { attack: 0.02, release: 0.45 }),
    ]).then(([violin, cello, backing]) => {
      this.violin = violin; this.cello = cello; this.backing = backing;
      violin.connect(this.stringBus); cello.connect(this.stringBus); backing.connect(this.backingBus);
      this.stringsReady = true;
    }).catch((e) => console.warn('strings failed to load', e));
  }

  get now() { return Tone.now(); }
  // what the listener hears right now (audio clock minus output latency)
  get heardNow() {
    const raw = Tone.getContext().rawContext;
    return raw.currentTime - (raw.outputLatency || raw.baseLatency || 0);
  }

  start() {
    if (!this.ready) return;
    const ctx = Tone.getContext().rawContext;
    if (ctx.state === 'suspended') ctx.resume();
    if (!this.nextCycleTime) this.nextCycleTime = this.now + 0.3;
    this.master.gain.cancelScheduledValues(this.now);
    this.master.gain.rampTo(this.volume, 0.3);
    this.playing = true;
    this._tick();
    this.timer = setInterval(() => this._tick(), 100);
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
  setBackingVolume(v) { this.backingVolume = v; if (this.backingBus) this.backingBus.gain.rampTo(v * 1.6, 0.2); }
  setStringsVolume(v) { this.stringsVolume = v; if (this.stringBus) this.stringBus.gain.rampTo(v, 0.2); }

  fadeOutAndPause(seconds = 20) {
    this.master.gain.rampTo(0, seconds);
    return new Promise((r) => setTimeout(async () => { await this.pause(); r(); }, seconds * 1000));
  }

  // Generate music a few seconds ahead, but hand notes to the samplers only ~0.8 s
  // before they sound, a few at a time, so no single tick creates hundreds of nodes.
  _tick() {
    if (!this.playing) return;
    while (this.nextCycleTime - this.now < this.horizon) this._scheduleCycle();
    // hidden tabs throttle timers to about once a second: feed further ahead there
    const until = this.now + (document.hidden ? 3 : 0.8);
    let i = 0;
    while (i < this.queue.length && this.queue[i].time < until) {
      const q = this.queue[i++];
      const inst = { piano: this.piano, violin: this.violin, cello: this.cello, backing: this.backing }[q.inst];
      if (!inst) continue; // strings still loading
      inst.triggerAttackRelease(q.name, q.hold, Math.max(this.now + 0.005, q.time), q.v);
    }
    if (i) this.queue.splice(0, i);
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
      // piano: a touch of pedal; strings: legato overlap
      const hold = n.inst === 'piano' ? dur * 1.15 : dur + 0.12;
      this.queue.push({ inst: n.inst, name: midiName(n.m), hold, time, v: n.v });
      this.onNote({ ...n, time, dur });
    }
    this.queue.sort((a, b) => a.time - b.time);
    this.onCycle({ ...cycle, startTime: this.nextCycleTime, endTime: end });
    this.nextCycleTime = end;
  }
}

function loadSampler(urls, baseUrl, opts) {
  return new Promise((resolve, reject) => {
    const s = new Tone.Sampler({ urls, baseUrl, ...opts, onload: () => resolve(s), onerror: reject });
  });
}

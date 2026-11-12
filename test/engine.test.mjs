// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanonEngine, MODES, MYTHIC_VOICES } from '../src/engine/engine.js';
import { HOME, mod12, isSemitoneClash } from '../src/engine/theory.js';

const run = (opts, n) => {
  const e = new CanonEngine(opts);
  return Array.from({ length: n }, () => e.next());
};

test('same seed gives the same performance', () => {
  const a = run({ seed: 4821 }, 50).map((c) => JSON.stringify(c.notes));
  const b = run({ seed: 4821 }, 50).map((c) => JSON.stringify(c.notes));
  assert.deepEqual(a, b);
  const c = run({ seed: 4822 }, 50).map((c) => JSON.stringify(c.notes));
  assert.notDeepEqual(a, c);
});

for (const mode of ['calm', 'bright', 'masterpiece', 'extreme', 'mythical']) {
  test(`${mode}: ground bass on every beat for 1,000 cycles`, () => {
    for (const c of run({ seed: 7, mode }, 1000)) {
      for (let b = 0; b < 8; b++) {
        const hit = c.notes.some((n) => n.voice === 'lh' && Math.abs(n.t - b) < 1e-6 && n.m === c.bass[b]);
        assert.ok(hit, `cycle ${c.index} beat ${b} missing ground`);
        if (!c.transition || b < 6) assert.equal(mod12(c.bass[b]), c.chords[b][0], 'bass is the chord root');
      }
    }
  });

  test(`${mode}: no two identical neighbouring cycles`, () => {
    const cs = run({ seed: 11, mode }, 1000);
    for (let i = 1; i < cs.length; i++) {
      const sig = (c) => c.notes.filter((n) => n.voice === 'rh').map((n) => `${n.t}:${n.m}`).join();
      assert.notEqual(sig(cs[i]), sig(cs[i - 1]), `cycles ${i - 1} and ${i} identical`);
    }
  });

  test(`${mode}: famous line in cycle 0 and at least every ~2 minutes`, () => {
    const e = new CanonEngine({ seed: 3, mode });
    const maxGap = Math.floor(120 / e.cycleSec);
    let gap = 0;
    for (let i = 0; i < 1000; i++) {
      const c = e.next();
      if (i === 0) assert.ok(c.famous);
      gap = c.famous ? 0 : gap + 1;
      assert.ok(gap <= maxGap, `gap ${gap} at ${i}`);
    }
  });

  test(`${mode}: modulates, always prepared, and comes home to D`, () => {
    const e = new CanonEngine({ seed: 5, mode });
    const maxAway = Math.ceil((10 * 60) / e.cycleSec);
    let away = 0;
    let mods = 0;
    let prevKey = HOME;
    for (let i = 0; i < 2000; i++) {
      const c = e.next();
      assert.equal(c.key, prevKey, 'key only changes after a transition cycle');
      if (c.transition) { mods++; prevKey = c.transition.to; } else prevKey = c.key;
      away = c.key === HOME ? 0 : away + 1;
      assert.ok(away <= maxAway, `away from D too long at ${i}`);
    }
    assert.ok(mods > 10, `only ${mods} modulations`);
  });

  test(`${mode}: no strong-beat semitone clashes between canon voices`, () => {
    for (const c of run({ seed: 9, mode }, 600)) {
      const rh = c.notes.filter((n) => n.voice === 'rh');
      const canon = c.notes.filter((n) => n.voice === 'c2');
      for (const x of canon) {
        if (Math.abs(x.t - Math.round(x.t)) > 1e-6) continue;
        const clash = rh.some((y) => y.t <= x.t + 1e-6 && x.t < y.t + y.d - 1e-6 && isSemitoneClash(x.m, y.m));
        assert.ok(!clash, `clash in cycle ${c.index} at ${x.t}`);
      }
    }
  });
}

test('calm never gets busy: no sixteenths, max 2 voices, no violin melody', () => {
  for (const c of run({ seed: 13, mode: 'calm' }, 1000)) {
    assert.ok(c.voices <= 2);
    assert.ok(c.level <= 3);
    for (const n of c.notes) {
      if (n.voice === 'rh') assert.ok(n.d >= 0.24 && !c.figures.some((f) => /16|alberti/.test(f)), 'sixteenths in calm');
      assert.notEqual(n.voice, 'vln');
    }
  }
});

test('bright reaches climaxes: 3 voices, 16ths and violins appear', () => {
  const cs = run({ seed: 13, mode: 'bright' }, 1000);
  assert.ok(cs.some((c) => c.voices === 3));
  assert.ok(cs.some((c) => c.figures.some((f) => /16|alberti/.test(f))));
  assert.ok(cs.some((c) => c.notes.some((n) => n.voice === 'vln')));
});

test('stay in D never modulates', () => {
  for (const c of run({ seed: 21, stayInD: true }, 1000)) {
    assert.equal(c.key, HOME);
    assert.equal(c.transition, null);
  }
});

test('notes stay in piano range and velocities are sane', () => {
  for (const c of run({ seed: 2, mode: 'bright' }, 1000)) {
    for (const n of c.notes) {
      assert.ok(n.m >= 21 && n.m <= 108, `midi ${n.m}`);
      assert.ok(n.v > 0 && n.v <= 1, `vel ${n.v}`);
      assert.ok(n.t >= 0 && n.t < 8 && n.d > 0);
    }
  }
});

test('masterpiece: up to 4 voices, violin counter-lines, more than bright', () => {
  const mp = run({ seed: 13, mode: 'masterpiece' }, 1000);
  const br = run({ seed: 13, mode: 'bright' }, 1000);
  assert.ok(mp.some((c) => c.voices === 4));
  assert.ok(mp.every((c) => c.voices <= 4));
  const avg = (cs) => cs.reduce((s, c) => s + c.voices, 0) / cs.length;
  assert.ok(avg(mp) > avg(br), `masterpiece ${avg(mp)} vs bright ${avg(br)}`);
  assert.ok(mp.filter((c) => c.notes.some((n) => n.voice === 'vln')).length > 500);
  for (const c of mp) assert.ok(c.level >= 3 || c.index < 6);
});

test('backing track: bassline (octave above the piano bass) on every beat, from the first cycle, in every mode', () => {
  for (const mode of ['calm', 'bright', 'masterpiece', 'extreme', 'mythical']) {
    for (const c of run({ seed: 17, mode, backing: true }, 300)) {
      for (let b = 0; b < 8; b++) {
        assert.ok(c.notes.some((n) => n.voice === 'backing' && Math.abs(n.t - b) < 1e-6 && n.m === (c.bass[b] + 12 <= 64 ? c.bass[b] + 12 : c.bass[b])), `${mode} ${c.index} ${b}`);
      }
      assert.ok(!c.notes.some((n) => n.voice === 'bass'), 'no doubled string cello when backing is on');
    }
  }
  assert.ok(!run({ seed: 17 }, 50).some((c) => c.notes.some((n) => n.voice === 'backing')), 'off by default');
});

test('extreme: reaches 6 voices, denser than masterpiece, no unison doubling', () => {
  const ex = run({ seed: 21, mode: 'extreme' }, 1000);
  const mp = run({ seed: 21, mode: 'masterpiece' }, 1000);
  assert.ok(ex.some((c) => c.voices === 6), 'six voices appear');
  assert.ok(ex.every((c) => c.voices <= 6));
  const avg = (cs) => cs.reduce((s, c) => s + c.voices, 0) / cs.length;
  assert.ok(avg(ex) > avg(mp), `extreme ${avg(ex)} vs masterpiece ${avg(mp)}`);
  assert.ok(ex.filter((c) => c.voices >= 5).length > 300, `mostly 5-6 voices: ${ex.filter((c) => c.voices >= 5).length}`);
  for (const c of ex) {
    const seen = new Set();
    for (const n of c.notes.filter((n) => n.inst === 'piano' && /^c\d$/.test(n.voice))) {
      const k = `${n.t.toFixed(4)}:${n.m}`;
      assert.ok(!seen.has(k), `doubling in cycle ${c.index}`);
      seen.add(k);
    }
  }
});

test('main.js wires each control once (no listeners added inside other handlers)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const id of ['musicOnly', 'quality', 'backing', 'play', 'drawerBtn']) {
    const n = src.split(`$('${id}').addEventListener`).length - 1 + src.split(`${id}Btn.addEventListener`).length - 1;
    assert.ok(n <= 1, `${id} wired ${n} times`);
  }
  assert.equal(src.split('function applyMusicOnly').length - 1, 1);
});

test('backing track is audibly distinct: never just doubles the piano left hand', () => {
  for (const mode of ['calm', 'bright', 'masterpiece', 'extreme', 'mythical']) {
    for (const c of run({ seed: 31, mode, backing: true }, 200)) {
      const lh = new Set(c.notes.filter((n) => n.voice === 'lh').map((n) => `${n.t}:${n.m}`));
      const back = c.notes.filter((n) => n.voice === 'backing');
      const doubled = back.filter((n) => lh.has(`${n.t}:${n.m}`)).length;
      assert.ok(doubled / back.length < 0.2, `${mode} cycle ${c.index}: ${doubled}/${back.length} doubled`);
      assert.ok(back.every((n) => n.m >= 24 && n.m <= 64));
    }
  }
});

test('mythical: the slowest default tempo, and the tempo slider reaches it', async () => {
  for (const [name, m] of Object.entries(MODES)) if (name !== 'mythical') assert.ok(MODES.mythical.bpm < m.bpm, `slower than ${name}`);
  assert.equal(new CanonEngine({ mode: 'mythical' }).bpm, MODES.mythical.bpm);
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const min = Number(html.match(/id="tempo"[^>]*min="(\d+)"/)[1]);
  assert.ok(min <= MODES.mythical.bpm - 5, `slider min ${min}`);
  assert.ok(html.includes('data-mode="mythical"'), 'mode button exists');
});

test('mythical: twelve voices at the peak, each with its own part, gathering as the energy rises', () => {
  const cs = run({ seed: 21, mode: 'mythical' }, 1000);
  const all = ['rh', ...MYTHIC_VOICES];
  assert.equal(all.length, 12);
  assert.ok(cs.every((c) => c.voices <= 12));
  const twelve = cs.filter((c) => c.voices === 12);
  assert.ok(twelve.length > 100, `12 voices in ${twelve.length} cycles`);
  for (const c of twelve) {
    assert.ok(c.energy >= 4.6, `12 voices only at the peak (energy ${c.energy})`);
    for (const v of all) assert.ok(c.notes.some((n) => n.voice === v), `cycle ${c.index}: ${v} is silent`);
    // no two voices play the same part: each differs from every other in its notes
    const sig = (v) => c.notes.filter((n) => n.voice === v).map((n) => `${n.t}:${n.d}:${n.m}`).join();
    assert.equal(new Set(all.map(sig)).size, 12, `cycle ${c.index}: two voices identical`);
  }
  // it opens alone and the voices come in step by step
  assert.equal(cs[0].voices, 1);
  const avg = (xs) => xs.reduce((s, c) => s + c.voices, 0) / xs.length;
  const band = (lo, hi) => avg(cs.filter((c) => c.index > 6 && c.energy >= lo && c.energy < hi));
  assert.ok(band(2, 2.8) < band(2.8, 3.6) && band(2.8, 3.6) < band(3.6, 4.4) && band(3.6, 4.4) < band(4.4, 5.1));
  for (let n = 1; n <= 12; n++) assert.ok(cs.some((c) => c.voices === n), `never exactly ${n} voices`);
  // every one of the twelve is heard for a good share of the time
  for (const v of all) assert.ok(cs.filter((c) => c.notes.some((n) => n.voice === v)).length >= 150, `${v} too rare`);
});

test('mythical: stays melodic and clear (sixteenths only at the peak, no key struck twice at once, sane range)', () => {
  const fast = (c) => c.figures.some((f) => /16|alberti/.test(f));
  const cs = run({ seed: 33, mode: 'mythical' }, 1000);
  const { surge } = MODES.mythical;
  assert.equal(surge[2], 4.5, 'the last step is the peak itself (level 5)');
  for (const c of cs) {
    const piano = c.notes.filter((n) => n.inst === 'piano');
    const extra = piano.filter((n) => n.voice !== 'rh' && n.voice !== 'lh');
    // the lead only runs at the peak itself
    if (c.level < 5) assert.ok(!fast(c), `cycle ${c.index}: sixteenth figures in the lead at level ${c.level}`);
    const cutVoices = extra.filter((y) => ['alto', 'tenor', 'echo', 'harp'].includes(y.voice));
    const onGrid = (x, div) => Math.abs(x.t * div - Math.round(x.t * div)) < 1e-6;
    if (c.energy < surge[0]) {
      // below the last climb: no rolling left hand, and the voices cut from the melody
      // keep to their slow parts (alto and tenor on the beat, one bell per beat)
      assert.notEqual(c.leftHand, 'grand');
      for (const v of ['alto', 'tenor', 'echo']) assert.ok(cutVoices.filter((x) => x.voice === v).length <= 8, `cycle ${c.index}: ${v} busy`);
    }
    // thirty-seconds only from the second step of the climb
    if (c.energy < surge[1]) for (const x of cutVoices) assert.ok(onGrid(x, 4), `cycle ${c.index}: ${x.voice} at ${x.t}`);
    for (const x of extra) {
      const twice = piano.filter((y) => y !== x && y.m === x.m && Math.abs(y.t - x.t) < 1e-6);
      assert.equal(twice.length, 0, `cycle ${c.index}: ${x.voice} doubles ${twice[0]?.voice} at ${x.t}`);
    }
    for (const n of c.notes) {
      assert.ok(n.m >= 21 && n.m <= 108, `midi ${n.m}`);
      assert.ok(n.v > 0 && n.v <= 1, `vel ${n.v}`);
      assert.ok(n.t >= 0 && n.t < 8 && n.d > 0);
      if (n.inst === 'violin') assert.ok(n.m >= 55, `violin too low: ${n.m}`);
    }
    // the voices cut from the melody only use notes of the chord they sound over
    const onChord = ['tenor', 'echo', 'harp', 'vln', 'vln2', 'cel'].concat(c.energy < surge[0] ? ['alto'] : []);
    for (const n of c.notes.filter((x) => onChord.includes(x.voice))) {
      assert.ok(c.chords[Math.floor(n.t)].includes(mod12(n.m)), `cycle ${c.index}: ${n.voice} off the chord at ${n.t}`);
    }
    // (on the climb the alto shadows the lead instead: a third or so under one of its notes)
    if (c.energy >= surge[0]) {
      const lead = c.notes.filter((x) => x.voice === 'rh');
      for (const n of c.notes.filter((x) => x.voice === 'alto')) {
        assert.ok(lead.some((y) => Math.abs(y.t - n.t) < 1e-6 && y.m - n.m >= 2 && y.m - n.m <= 5), `cycle ${c.index}: alto adrift at ${n.t}`);
      }
    }
  }
  const peak = cs.filter((c) => c.level >= 5);
  assert.ok(peak.filter(fast).length > peak.length / 2, `the lead runs in most peak cycles: ${peak.filter(fast).length}/${peak.length}`);
  assert.ok(peak.some((c) => c.leftHand === 'grand'));
});

test('mythical: the peak is busier than Extreme but no louder, and is reached by a build', () => {
  const load = (mode, pick) => {
    const e = new CanonEngine({ seed: 21, mode });
    const cs = Array.from({ length: 1000 }, () => e.next()).filter(pick);
    const piano = (c) => c.notes.filter((n) => n.inst === 'piano');
    const mean = (f) => cs.reduce((s, c) => s + f(c), 0) / cs.length;
    return {
      rate: mean((c) => piano(c).length) / e.cycleSec,
      all: mean((c) => c.notes.length) / e.cycleSec,
      // energy of the piano notes sounding on each beat, worst beat of the cycle, averaged
      power: mean((c) => Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((b) =>
        Math.sqrt(piano(c).filter((n) => n.t <= b + 0.2 && b < n.t + n.d).reduce((q, n) => q + n.v * n.v, 0))))),
      // energy of all the piano notes struck, per second
      flux: mean((c) => piano(c).reduce((q, n) => q + n.v * n.v, 0)) / e.cycleSec,
    };
  };
  const my = load('mythical', (c) => c.energy >= 4.6);
  const ex = load('extreme', (c) => c.energy >= 4.6);
  assert.ok(my.rate > ex.rate * 1.1, `piano notes per second ${my.rate} vs ${ex.rate}`);
  assert.ok(my.all > ex.all * 1.1, `notes per second ${my.all} vs ${ex.all}`);
  assert.ok(my.power <= ex.power * 1.05, `piano level ${my.power} vs ${ex.power}`);
  assert.ok(my.flux <= ex.flux, `piano energy per second ${my.flux} vs ${ex.flux}`);
  // below the last climb it is far calmer than Extreme, and the climb is a build, not a switch
  const [s1, s2, s3] = MODES.mythical.surge;
  const band = (lo, hi) => load('mythical', (c) => c.index > 6 && c.energy >= lo && c.energy < hi).rate;
  const steps = [band(3.6, s1), band(s1, s2), band(s2, s3), band(s3, 4.6), my.rate];
  assert.ok(band(0, s1) < ex.rate * 0.5, `below the climb: ${band(0, s1)} piano notes per second vs Extreme's ${ex.rate}`);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i] > steps[i - 1] && steps[i] < steps[i - 1] * 1.5, `piano notes per second by step: ${steps.map((x) => x.toFixed(1))}`);
  }
});

test('mythical: at the peak the top octave is heard over the low end at least as well as in Extreme', () => {
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const balance = (mode, top) => {
    const notes = run({ seed: 21, mode }, 1000).filter((c) => c.voices === top).flatMap((c) => c.notes);
    const piano = notes.filter((n) => n.inst === 'piano');
    const v = (pick) => mean(piano.filter(pick).map((n) => n.v));
    const sum = (a) => a.reduce((s, n) => s + n.v, 0);
    return {
      lh: v((n) => n.voice === 'lh'),
      top: v((n) => n.m >= 84), // C6 and up
      voice: (name) => v((n) => n.voice === name),
      low: sum(notes.filter((n) => n.m < 60)) / sum(notes), // share of the level under middle C
    };
  };
  const my = balance('mythical', 12);
  const ex = balance('extreme', 6);
  assert.ok(my.top >= 0.2, `top octave level ${my.top}`);
  assert.ok(my.voice('echo') >= 0.18 && my.voice('c4') >= 0.18, `bells ${my.voice('echo')}, top canon line ${my.voice('c4')}`);
  assert.ok(my.lh / my.top <= ex.lh / ex.top, `left hand over top octave: ${my.lh / my.top} vs Extreme's ${ex.lh / ex.top}`);
  assert.ok(my.low < ex.low, `share of the level under middle C: ${my.low} vs Extreme's ${ex.low}`);
  // the left hand gives way as the voices gather, and has its full weight when it is alone
  // (the ground note on each bar's first beat, with the energy's own loudness taken out)
  const ground = (opts) => {
    const out = [];
    for (const c of run({ seed: 21, mode: 'mythical', ...opts }, 600)) {
      if (c.energy < 4.6) continue;
      for (const n of c.notes) if (n.voice === 'lh' && n.t % 2 < 1e-6 && n.m === c.bass[n.t]) out.push(n.v / (0.3 + 0.09 * c.energy));
    }
    return mean(out);
  };
  const full = ground({ canon: false });
  const peak = ground({});
  assert.ok(peak < full * 0.8 && peak > full * 0.7, `left hand under all twelve: ${peak} of ${full} alone`);
});

test('audio: the left hand and the cellos are routed apart, and the hall takes less of them', async () => {
  const { samplerFor, HALL_LOW } = await import('../src/audio/audio.js');
  assert.ok(HALL_LOW > 0 && HALL_LOW <= 0.5);
  assert.equal(samplerFor({ inst: 'piano', voice: 'lh' }), 'pianoLow');
  for (const voice of ['rh', 'c2', 'c3', 'c4', 'alto', 'tenor', 'echo', 'harp']) assert.equal(samplerFor({ inst: 'piano', voice }), 'piano');
  for (const inst of ['violin', 'cello', 'backing']) assert.equal(samplerFor({ inst, voice: 'x' }), inst);
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/audio/audio.js', import.meta.url), 'utf8');
  // only the upper parts feed the hall directly; the low buses go through the HALL_LOW gain
  assert.match(src, /for \(const bus of \[this\.pianoBus, this\.stringBus\]\) bus\.connect\(this\.hallSend\)/);
  assert.match(src, /for \(const bus of \[this\.pianoLowBus, this\.celloBus, this\.backingBus\]\) bus\.connect\(this\.hallLow\)/);
  assert.match(src, /this\.hallLow = new Tone\.Gain\(HALL_LOW\)\.connect\(this\.hallSend\)/);
  // every sampler the scheduler can name exists
  for (const name of ['piano', 'pianoLow', 'violin', 'cello', 'backing']) assert.ok(src.includes(`this.${name} = `), name);
});

test('mythical: canon and strings switches still thin it out', () => {
  const noCanon = run({ seed: 21, mode: 'mythical', canon: false }, 400);
  assert.ok(noCanon.every((c) => !c.notes.some((n) => n.inst === 'piano' && n.voice !== 'rh' && n.voice !== 'lh')));
  const noStrings = run({ seed: 21, mode: 'mythical', strings: false }, 400);
  assert.ok(noStrings.every((c) => c.notes.every((n) => n.inst === 'piano') && c.voices <= 8));
});

test('the page offers every mode the engine has, with a look for each', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
  const [html, roll, css] = await Promise.all([read('../index.html'), read('../src/ui/roll.js'), read('../style.css')]);
  for (const mode of Object.keys(MODES)) {
    assert.ok(html.includes(`data-mode="${mode}"`), `${mode} button`);
    assert.ok(new RegExp(`^  ${mode}: \\{`, 'm').test(roll), `${mode} roll theme`);
    assert.ok(css.includes(`body[data-mode="${mode}"]`), `${mode} accent colour`);
  }
});

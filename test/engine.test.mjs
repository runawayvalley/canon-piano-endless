// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanonEngine } from '../src/engine/engine.js';
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

for (const mode of ['calm', 'bright']) {
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

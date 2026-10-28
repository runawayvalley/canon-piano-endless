// Music theory helpers: keys, scales, chords, the Canon's ground and progression.

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const NOTE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

export const HOME = 2; // D

// I – V – vi – iii – IV – I – IV – V  (0-based scale degrees of the chord roots)
export const PROGRESSION = [0, 4, 5, 2, 3, 0, 3, 4];
// Ground bass D3 A2 B2 F#2 G2 D2 G2 A2, as scale degrees relative to the tonic (D3).
export const GROUND = [0, -3, -2, -5, -4, -7, -4, -3];
// The famous line F# E D C# B A B C#, degrees relative to the melody tonic.
export const FAMOUS = [2, 1, 0, -1, -2, -3, -2, -1];
// Pachelbel's second line D C# B A G F# G E.
export const DESCENT = [0, -1, -2, -3, -4, -5, -4, -6];

export const mod12 = (n) => ((n % 12) + 12) % 12;

// Tonic MIDI note around middle C for a key (keeps the register stable across keys).
export function tonicMidi(keyPc) {
  let m = 60 + mod12(keyPc);
  if (m > 65) m -= 12; // G, A♭, A, B♭, B sit just below middle C
  return m;
}

export function scalePcs(keyPc) {
  return MAJOR.map((i) => mod12(keyPc + i));
}

// Diatonic degree (any integer) → MIDI, relative to a tonic MIDI note.
export function degToMidi(tonic, deg) {
  const o = Math.floor(deg / 7);
  const d = ((deg % 7) + 7) % 7;
  return tonic + MAJOR[d] + 12 * o;
}

export function triadPcs(rootPc, quality) {
  const third = quality === 'min' ? 3 : 4;
  const pcs = [mod12(rootPc), mod12(rootPc + third), mod12(rootPc + 7)];
  if (quality === 'dom7') pcs.push(mod12(rootPc + 10));
  return pcs;
}

// The diatonic chord for one beat of the progression in a key.
export function diatonicChord(keyPc, beat) {
  const sc = scalePcs(keyPc);
  const d = PROGRESSION[beat];
  return {
    rootPc: sc[d],
    pcs: [sc[d], sc[(d + 2) % 7], sc[(d + 4) % 7]],
    seventh: sc[(d + 6) % 7],
    scale: sc,
    diatonic: true,
  };
}

// Chromatic pivot chord (major or dom7) with a major scale on its root for passing tones.
export function pivotChord(rootPc, quality = 'maj') {
  return {
    rootPc: mod12(rootPc),
    pcs: triadPcs(rootPc, quality),
    seventh: mod12(rootPc + (quality === 'dom7' ? 10 : 11)),
    scale: scalePcs(rootPc).map((pc) => (quality === 'dom7' && pc === mod12(rootPc + 11) ? mod12(rootPc + 10) : pc)),
    diatonic: false,
  };
}

// Move n scale steps from a MIDI note (snaps to the scale first).
export function scaleStep(m, n, scale) {
  let cur = snapToScale(m, scale);
  const dir = Math.sign(n);
  for (let i = 0; i < Math.abs(n); i++) {
    cur += dir;
    while (!scale.includes(mod12(cur))) cur += dir;
  }
  return cur;
}

export function snapToScale(m, scale) {
  if (scale.includes(mod12(m))) return m;
  if (scale.includes(mod12(m - 1))) return m - 1;
  return m + 1;
}

export function chordToneAbove(m, pcs) {
  let c = m + 1;
  while (!pcs.includes(mod12(c))) c++;
  return c;
}

export function chordToneBelow(m, pcs) {
  let c = m - 1;
  while (!pcs.includes(mod12(c))) c--;
  return c;
}

export function nearestChordTone(m, pcs) {
  if (pcs.includes(mod12(m))) return m;
  const up = chordToneAbove(m, pcs);
  const down = chordToneBelow(m, pcs);
  return up - m <= m - down ? up : down;
}

// All chord tones in [lo, hi].
export function chordTonesIn(pcs, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m);
  return out;
}

export function isSemitoneClash(a, b) {
  const d = mod12(a - b);
  return d === 1 || d === 11;
}

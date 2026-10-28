// Right-hand figures: how one skeleton note per beat becomes a rhythm.
// Each figure turns (cur, next, chord) into notes inside one beat: {t, d, m, v}
// t/d in beats (0 ≤ t < 1 within the beat), m = MIDI, v = relative velocity.
import { scaleStep, chordToneAbove, chordToneBelow, mod12 } from './theory.js?v=11';

const n = (t, d, m, v = 1) => ({ t, d, m, v });

export const FIGURES = [
  {
    name: 'half', min: 1, max: 2, s16: false,
    // half notes: speak on even beats, hold through odd beats
    render: ({ cur, beat }) => (beat % 2 === 0 ? [n(0, 1.95, cur, 1)] : []),
    keepsContour: false,
  },
  {
    name: 'quarter', min: 1, max: 3, s16: false,
    render: ({ cur }) => [n(0, 0.98, cur)],
    keepsContour: true,
  },
  {
    name: 'quarterThird', min: 1, max: 3, s16: false,
    render: ({ cur, chord }) => [n(0, 0.98, cur), n(0, 0.98, chordToneBelow(cur, chord.pcs), 0.7)],
    keepsContour: true,
  },
  {
    name: 'rolled', min: 1, max: 3, s16: false,
    render: ({ cur, chord }) => {
      const mid = chordToneBelow(cur, chord.pcs);
      const low = chordToneBelow(mid, chord.pcs);
      return [n(0, 0.95, low, 0.6), n(0.07, 0.88, mid, 0.7), n(0.14, 0.82, cur, 1)];
    },
    keepsContour: true,
  },
  {
    name: 'eighthStep', min: 2, max: 4, s16: false,
    render: ({ cur, next, chord }) => {
      const dir = next === cur ? 1 : Math.sign(next - cur);
      return [n(0, 0.5, cur), n(0.5, 0.5, scaleStep(cur, dir, chord.scale), 0.8)];
    },
    keepsContour: true,
  },
  {
    name: 'eighthArp', min: 2, max: 4, s16: false,
    render: ({ cur, chord }) => [n(0, 0.5, cur), n(0.5, 0.5, chordToneAbove(cur, chord.pcs), 0.8)],
    keepsContour: true,
  },
  {
    name: 'eighthNeighbor', min: 2, max: 3, s16: false,
    render: ({ cur, chord }) => [n(0, 0.5, cur), n(0.5, 0.5, scaleStep(cur, 1, chord.scale), 0.75)],
    keepsContour: true,
  },
  {
    name: 'penta', min: 2, max: 4, s16: false,
    // pentatonic sparkle: skip the 4th and 7th of the key
    render: ({ cur, keyPc, chord }) => {
      let up = chordToneAbove(cur, chord.pcs);
      const rel = mod12(up - keyPc);
      if (rel === 5 || rel === 11) up = chordToneAbove(up, chord.pcs);
      return [n(0, 0.5, cur), n(0.5, 0.25, up, 0.7), n(0.75, 0.25, cur, 0.6)];
    },
    keepsContour: true,
  },
  {
    name: 'dotted', min: 3, max: 5, s16: false,
    render: ({ cur, next, chord }) => {
      const dir = next === cur ? -1 : Math.sign(next - cur);
      return [n(0, 0.72, cur), n(0.75, 0.25, scaleStep(cur, dir, chord.scale), 0.75)];
    },
    keepsContour: true,
  },
  {
    name: 'brokenOctave', min: 3, max: 5, s16: false,
    render: ({ cur }) => [n(0, 0.5, cur), n(0.5, 0.5, cur + 12 <= 96 ? cur + 12 : cur - 12, 0.75)],
    keepsContour: true,
  },
  {
    name: 'alberti', min: 3, max: 5, s16: true,
    render: ({ cur, chord }) => {
      const mid = chordToneBelow(cur, chord.pcs);
      const low = chordToneBelow(mid, chord.pcs);
      return [n(0, 0.25, cur), n(0.25, 0.25, low, 0.65), n(0.5, 0.25, mid, 0.7), n(0.75, 0.25, low, 0.65)];
    },
    keepsContour: true,
  },
  {
    name: 'run16', min: 4, max: 5, s16: true,
    // Pachelbel's scale runs: four sixteenths heading for the next note
    render: ({ cur, next, chord }) => {
      const dir = next >= cur ? 1 : -1;
      return [0, 1, 2, 3].map((i) => n(i * 0.25, 0.25, scaleStep(cur, dir * i, chord.scale), i === 0 ? 1 : 0.75));
    },
    keepsContour: true,
  },
  {
    name: 'turn16', min: 4, max: 5, s16: true,
    render: ({ cur, chord }) => [
      n(0, 0.25, cur), n(0.25, 0.25, scaleStep(cur, 1, chord.scale), 0.75),
      n(0.5, 0.25, cur, 0.8), n(0.75, 0.25, scaleStep(cur, -1, chord.scale), 0.75),
    ],
    keepsContour: true,
  },
  {
    name: 'arp16', min: 4, max: 5, s16: true,
    render: ({ cur, chord }) => {
      const a = chordToneBelow(chordToneBelow(cur, chord.pcs), chord.pcs);
      const b = chordToneAbove(a, chord.pcs);
      return [n(0, 0.25, cur), n(0.25, 0.25, a, 0.7), n(0.5, 0.25, b, 0.75), n(0.75, 0.25, cur, 0.8)];
    },
    keepsContour: true,
  },
];

export const figureByName = Object.fromEntries(FIGURES.map((f) => [f.name, f]));

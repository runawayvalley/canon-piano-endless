import { CanonEngine, MODES } from './engine/engine.js?v=6';
import { randomSeed } from './engine/rng.js?v=6';
import { CanonAudio } from './audio/audio.js?v=6';
import { PianoRoll } from './ui/roll.js?v=6';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const saved = JSON.parse(localStorage.getItem('canon-endless') || '{}');

const state = {
  seed: Number(params.get('seed')) || randomSeed(),
  mode: params.get('mode') in MODES ? params.get('mode') : saved.mode in MODES ? saved.mode : 'calm',
  strings: saved.strings ?? true,
  canon: saved.canon ?? true,
  stayInD: saved.stayInD ?? false,
  volume: saved.volume ?? 0.85,
  stringsVol: saved.stringsVol ?? 0.8,
  backing: saved.backing ?? false,
  backingVol: saved.backingVol ?? 0.8,
  quality: saved.quality ?? 'auto',
  musicOnly: saved.musicOnly ?? false,
};
state.bpm = saved.bpm?.[state.mode] ?? MODES[state.mode].bpm;
const persist = () => localStorage.setItem('canon-endless', JSON.stringify({
  mode: state.mode, strings: state.strings, canon: state.canon, stayInD: state.stayInD,
  volume: state.volume, stringsVol: state.stringsVol, backing: state.backing, backingVol: state.backingVol, quality: state.quality, musicOnly: state.musicOnly, bpm: { ...(saved.bpm || {}), [state.mode]: state.bpm },
}));

const makeEngine = () => new CanonEngine({
  seed: state.seed, mode: state.mode, strings: state.strings, canon: state.canon,
  stayInD: state.stayInD, backing: state.backing, bpm: state.bpm,
});

let engine = makeEngine();
const cycles = [];
let audio = null;
let startedAt = null;
let sleepTimer = null;

const roll = new PianoRoll($('roll'), () => (audio?.ready ? audio.heardNow : 0));
roll.setMode(state.mode);
roll.setQuality(state.quality);
function applyMusicOnly() {
  document.body.classList.toggle('music-only', state.musicOnly);
  $('musicOnly').setAttribute('aria-pressed', String(state.musicOnly));
  roll.setEnabled(!state.musicOnly);
}
applyMusicOnly();
$('musicOnly').addEventListener('click', () => { state.musicOnly = !state.musicOnly; applyMusicOnly(); persist(); });

// ---- UI wiring --------------------------------------------------------------
const playBtn = $('play');
const status = $('status');

function syncControls() {
  document.querySelectorAll('.modes button').forEach((b) => {
    const on = b.dataset.mode === state.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  $('tempo').value = state.bpm; $('tempoOut').textContent = state.bpm;
  $('volume').value = state.volume;
  $('strings').checked = state.strings;
  $('stringsVol').value = state.stringsVol;
  $('canon').checked = state.canon;
  $('stayInD').checked = state.stayInD;
  $('backing').checked = state.backing;
  $('backingVol').value = state.backingVol;
  $('quality').value = state.quality;
  $('seed').textContent = state.seed;
}
syncControls();

playBtn.addEventListener('click', async () => {
  if (!audio) {
    playBtn.classList.add('loading');
    status.textContent = 'Loading piano…';
    audio = new CanonAudio(engine, {
      onNote: (n) => roll.add(n),
      onCycle: (c) => { cycles.push(c); if (cycles.length > 8) cycles.shift(); },
    });
    audio.setVolume(state.volume);
    audio.setStringsVolume(state.strings ? state.stringsVol : 0);
    audio.setBackingVolume(state.backingVol);
    try {
      await audio.init((msg) => { status.textContent = msg; });
    } catch (e) {
      console.error(e);
      status.textContent = 'Could not load the piano. Check your connection and try again.';
      playBtn.classList.remove('loading');
      audio = null;
      return;
    }
    playBtn.classList.remove('loading');
  }
  if (audio.playing) {
    await audio.pause();
    setPlaying(false);
  } else {
    audio.start();
    if (startedAt === null) startedAt = audio.now;
    setPlaying(true);
  }
});

function setPlaying(on) {
  playBtn.classList.toggle('playing', on);
  playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  status.textContent = on ? '' : 'Paused';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
}

document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  state.bpm = saved.bpm?.[state.mode] ?? MODES[state.mode].bpm;
  engine.setMode(state.mode);
  engine.bpm = state.bpm;
  roll.setMode(state.mode);
roll.setQuality(state.quality);
function applyMusicOnly() {
  document.body.classList.toggle('music-only', state.musicOnly);
  $('musicOnly').setAttribute('aria-pressed', String(state.musicOnly));
  roll.setEnabled(!state.musicOnly);
}
applyMusicOnly();
$('musicOnly').addEventListener('click', () => { state.musicOnly = !state.musicOnly; applyMusicOnly(); persist(); });
  persist(); syncControls();
}));

$('tempo').addEventListener('input', (e) => {
  state.bpm = Number(e.target.value); engine.bpm = state.bpm;
  $('tempoOut').textContent = state.bpm; persist();
});
$('volume').addEventListener('input', (e) => { state.volume = Number(e.target.value); audio?.setVolume(state.volume); persist(); });
$('strings').addEventListener('change', (e) => {
  state.strings = e.target.checked; engine.setOptions({ strings: state.strings });
  audio?.setStringsVolume(state.strings ? state.stringsVol : 0); persist();
});
$('stringsVol').addEventListener('input', (e) => {
  state.stringsVol = Number(e.target.value); if (state.strings) audio?.setStringsVolume(state.stringsVol); persist();
});
$('quality').addEventListener('change', (e) => { state.quality = e.target.value; roll.setQuality(state.quality); persist(); });
$('backing').addEventListener('change', (e) => { state.backing = e.target.checked; engine.setOptions({ backing: state.backing }); persist(); });
$('backingVol').addEventListener('input', (e) => { state.backingVol = Number(e.target.value); audio?.setBackingVolume(state.backingVol); persist(); });
$('canon').addEventListener('change', (e) => { state.canon = e.target.checked; engine.setOptions({ canon: state.canon }); persist(); });
$('stayInD').addEventListener('change', (e) => { state.stayInD = e.target.checked; engine.setOptions({ stayInD: state.stayInD }); persist(); });

$('sleep').addEventListener('change', (e) => {
  clearTimeout(sleepTimer);
  const min = Number(e.target.value);
  if (!min) return;
  sleepTimer = setTimeout(async () => {
    if (audio?.playing) { await audio.fadeOutAndPause(20); setPlaying(false); }
    $('sleep').value = '0';
  }, min * 60 * 1000);
});

$('share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?seed=${state.seed}&mode=${state.mode}`;
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Copied'; } catch { prompt('Copy this link', url); }
  setTimeout(() => { $('share').textContent = 'Copy link'; }, 1500);
});
$('newSeed').addEventListener('click', () => {
  state.seed = randomSeed();
  engine = makeEngine();
  if (audio) audio.engine = engine;
  history.replaceState(null, '', `?seed=${state.seed}`);
  syncControls();
});

const drawer = $('drawer');
$('drawerBtn').addEventListener('click', () => {
  drawer.hidden = !drawer.hidden;
  $('drawerBtn').setAttribute('aria-expanded', !drawer.hidden);
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) $('musicOnly').click();
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault(); playBtn.click();
  }
});

// lock-screen / headset controls
if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Canon in D · Endless', artist: 'Pachelbel, generative', album: 'Canon · Endless' });
  navigator.mediaSession.setActionHandler('play', () => { if (!audio?.playing) playBtn.click(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (audio?.playing) playBtn.click(); });
}

// ---- info line --------------------------------------------------------------
const fmt = (s) => {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
};
setInterval(() => {
  if (!audio?.ready || startedAt === null) return;
  const now = audio.heardNow;
  const cur = [...cycles].reverse().find((c) => c.startTime <= now);
  if (!cur) return;
  roll.setKey(cur.key);
  const voices = cur.voices > 1 ? ` · ${cur.voices} voices` : '';
  const change = cur.transition ? ` → ${cur.transition.toName}` : '';
  $('info').textContent = `Variation ${cur.index + 1} · ${cur.keyName} major${change}${voices} · ${fmt(now - startedAt)}`;
}, 250);

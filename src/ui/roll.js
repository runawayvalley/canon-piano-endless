// Falling-note piano roll with a different look per mode, tuned to stay smooth.
//  calm:        soft halo, drifting dust, night-blue sky
//  bright:      warm gold, sparks burst from notes as they land
//  masterpiece: aurora ribbons overhead, ripples on every hit, jewel colours
//
// Performance notes: no shadowBlur (it blurs every note on every frame), the sky and
// aurora are painted on a quarter-resolution canvas behind the notes, the keyboard is
// cached, and quality drops automatically if frames take too long.
const LOW = 28; // E1
const HIGH = 98; // D7
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

const THEMES = {
  calm: {
    seconds: 4.5,
    bg: ['#141a33', '#0b0e1c'],
    colors: {
      rh: [196, 186, 240], lh: [120, 150, 220], c2: [150, 200, 230], c3: [180, 160, 230], c4: [220, 220, 255],
      pad: [120, 120, 210], bass: [90, 100, 190], vln: [210, 190, 250], backing: [80, 130, 200],
    },
    halo: 0.18,
    dust: 50,
  },
  bright: {
    seconds: 3.5,
    bg: ['#2a1e1a', '#120d10'],
    colors: {
      rh: [245, 200, 110], lh: [240, 150, 90], c2: [250, 120, 110], c3: [255, 220, 150], c4: [255, 245, 210],
      pad: [240, 160, 100], bass: [200, 110, 80], vln: [255, 225, 160], backing: [220, 120, 70],
    },
    halo: 0.12,
    sparks: 5,
  },
  masterpiece: {
    seconds: 3,
    bg: ['#1a1030', '#07060f'],
    colors: {
      rh: [255, 210, 120], lh: [110, 140, 255], c2: [255, 120, 170], c3: [90, 220, 200], c4: [245, 245, 255],
      pad: [160, 110, 255], bass: [90, 80, 200], vln: [255, 190, 230], backing: [120, 90, 230],
    },
    halo: 0.2,
    ripples: true,
    aurora: true,
    sparks: 2,
  },
};
for (const th of Object.values(THEMES)) {
  th.css = {};
  for (const [k, [r, g, b]] of Object.entries(th.colors)) th.css[k] = `rgb(${r},${g},${b})`;
}

export class PianoRoll {
  constructor(canvas, getNow) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.className = 'roll-bg';
    this.bgCanvas.setAttribute('aria-hidden', 'true');
    canvas.parentNode.insertBefore(this.bgCanvas, canvas);
    this.bg = this.bgCanvas.getContext('2d');
    this.keysCanvas = document.createElement('canvas');
    this.getNow = getNow;
    this.notes = [];
    this.particles = [];
    this.ripples = [];
    this.dust = [];
    this.keyPc = 2;
    this.qualityPref = 'auto';
    this.low = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.slowFrames = 0;
    this.frame = 0;
    this.lastBg = -1;
    this.mode = 'calm';
    this.theme = THEMES.calm;
    this.enabled = true;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    const loop = (t) => {
      const ms = t - this.last; this.last = t;
      if (!this.enabled) { requestAnimationFrame(loop); return; }
      this._adapt(ms);
      this.draw(Math.min(0.05, ms / 1000), t / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setMode(mode) {
    this.mode = mode in THEMES ? mode : 'calm';
    this.theme = THEMES[this.mode];
    this.particles.length = 0;
    this.ripples.length = 0;
    document.body.dataset.mode = this.mode;
    this._paintBg(0, true);
  }

  setKey(pc) { this.keyPc = pc; }

  // Music only: stop drawing entirely (no canvas work at all while hidden)
  setEnabled(on) {
    this.enabled = on;
    this.notes.length = 0; this.particles.length = 0; this.ripples.length = 0;
    if (!on) this.ctx.clearRect(0, 0, this.w, this.h);
  }

  // 'auto' | 'high' | 'low'
  setQuality(q) {
    this.qualityPref = q;
    this.low = q === 'low' || (q === 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.slowFrames = 0;
    this.resize();
  }

  _adapt(ms) {
    if (this.qualityPref !== 'auto' || this.low || document.hidden) return;
    // ~40 slow frames out of the last stretch => drop to low quality
    if (ms > 24 && ms < 250) this.slowFrames += 1;
    else this.slowFrames = Math.max(0, this.slowFrames - 0.25);
    if (this.slowFrames > 40) { this.low = true; this.resize(); }
  }

  resize() {
    const dpr = this.low ? 1 : Math.min(1.5, devicePixelRatio || 1);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bgScale = 0.25;
    this.bgCanvas.width = Math.ceil(this.w * this.bgScale); this.bgCanvas.height = Math.ceil(this.h * this.bgScale);
    this.keyH = Math.max(46, Math.min(80, this.h * 0.09));
    this.hitY = this.h - this.keyH;
    this.keyW = this.w / (HIGH - LOW + 1);
    this.dust = Array.from({ length: 60 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, s: Math.random() * 8 + 4, p: Math.random() * 6 }));
    this._paintKeys(dpr);
    this._paintBg(0, true);
  }

  _paintKeys(dpr) {
    const c = this.keysCanvas;
    c.width = Math.round(this.w * dpr); c.height = Math.round(this.keyH * dpr);
    const k = c.getContext('2d');
    k.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let m = LOW; m <= HIGH; m++) {
      k.fillStyle = isBlack(m) ? 'rgba(20,22,36,0.95)' : 'rgba(225,220,205,0.16)';
      k.fillRect((m - LOW) * this.keyW + 0.5, 2, this.keyW - 1, isBlack(m) ? this.keyH * 0.62 : this.keyH - 2);
    }
  }

  // sky (+ aurora) on the small background canvas; the browser scales it up smoothly
  _paintBg(t, force) {
    const th = this.theme;
    if (!force && !th.aurora) return;
    const interval = this.low ? 0.25 : 0.066;
    if (!force && t - this.lastBg < interval) return;
    this.lastBg = t;
    const { bg } = this;
    const w = this.bgCanvas.width; const h = this.bgCanvas.height;
    const g = bg.createRadialGradient(w / 2, h * 0.2, 0, w / 2, h * 0.2, Math.max(w, h));
    g.addColorStop(0, th.bg[0]); g.addColorStop(0.7, th.bg[1]);
    bg.globalCompositeOperation = 'source-over';
    bg.fillStyle = g; bg.fillRect(0, 0, w, h);
    if (!th.aurora) return;
    bg.globalCompositeOperation = 'lighter';
    const baseHue = (this.keyPc * 30 + 260) % 360;
    for (let i = 0; i < 3; i++) {
      const hue = (baseHue + i * 40 + Math.sin(t * 0.05 + i) * 20) % 360;
      const yBase = h * (0.16 + i * 0.09);
      bg.beginPath();
      bg.moveTo(0, yBase);
      for (let x = 0; x <= w; x += 6) {
        const X = x / this.bgScale;
        bg.lineTo(x, yBase + (Math.sin(X * 0.004 + t * (0.15 + i * 0.05) + i * 2) * 40 + Math.sin(X * 0.011 - t * 0.2) * 14) * this.bgScale);
      }
      bg.lineTo(w, yBase + 35); bg.lineTo(0, yBase + 35); bg.closePath();
      const gr = bg.createLinearGradient(0, yBase - 10, 0, yBase + 35);
      gr.addColorStop(0, `hsla(${hue},80%,65%,0)`);
      gr.addColorStop(0.3, `hsla(${hue},80%,65%,0.13)`);
      gr.addColorStop(1, `hsla(${hue},80%,50%,0)`);
      bg.fillStyle = gr;
      bg.fill();
    }
  }

  add(n) { if (this.enabled) this.notes.push(n); }

  _onHit(n, x) {
    if (n.inst !== 'piano' && n.inst !== 'backing') return;
    const th = this.theme;
    const col = th.css[n.voice] || th.css.rh;
    const sparks = this.low ? Math.floor((th.sparks || 0) / 2) : th.sparks;
    if (sparks) {
      const count = Math.max(1, Math.round(sparks * (0.5 + n.v)));
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const sp = 60 + Math.random() * 160 * n.v;
        this.particles.push({ x, y: this.hitY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.5, age: 0, col });
      }
      if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
    }
    if (th.ripples && (!this.low || n.voice === 'rh')) {
      this.ripples.push({ x, y: this.hitY, age: 0, life: 1.2, max: 30 + 80 * n.v, col });
      if (this.ripples.length > 60) this.ripples.splice(0, this.ripples.length - 60);
    }
  }

  draw(dt, t) {
    const { ctx, w, hitY, keyW } = this;
    const th = this.theme;
    const now = this.getNow();
    const pps = hitY / th.seconds;
    this.frame++;

    this._paintBg(t, false);
    ctx.clearRect(0, 0, w, this.h);

    if (th.dust) {
      ctx.fillStyle = 'rgb(200,210,255)';
      const n = this.low ? 25 : th.dust;
      for (let i = 0; i < n; i++) {
        const d = this.dust[i];
        d.y -= d.s * dt;
        if (d.y < -5) { d.y = this.h + 5; d.x = Math.random() * w; }
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 0.8 + d.p);
        ctx.fillRect(d.x + Math.sin(t * 0.3 + d.p) * 6, d.y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    if (this.frame % 30 === 0) this.notes = this.notes.filter((n) => n.time + n.dur > now - 0.5);
    const active = this.active || (this.active = new Map());
    active.clear();
    const halo = this.low ? 0 : th.halo;
    const radius = Math.max(1, Math.min(4, keyW / 3));

    // strings first (wide, faint bands), then piano on top
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.notes.length; i++) {
        const n = this.notes[i];
        const isStr = n.inst !== 'piano';
        if ((pass === 0) !== isStr) continue;
        const x = (n.m - LOW) * keyW;
        if (!n._hit && n.time <= now) { n._hit = true; this._onHit(n, x + keyW / 2); }
        const y1 = hitY - (n.time - now) * pps;
        const y0 = y1 - n.dur * pps;
        if (y0 > hitY || y1 < 0) continue;
        const top = Math.max(0, y0);
        const hgt = Math.max(2, Math.min(hitY, y1) - top);
        ctx.fillStyle = th.css[n.voice] || th.css.rh;
        if (isStr) {
          const wide = n.voice === 'vln' && this.mode === 'masterpiece' ? 2.2 : 4;
          ctx.globalAlpha = 0.05 + n.v * 0.12;
          ctx.fillRect(x - keyW * (wide - 1) / 2, top, keyW * wide, hgt);
        } else {
          if (halo) {
            ctx.globalAlpha = halo * n.v;
            ctx.fillRect(x - 3, top - 3, keyW + 6, hgt + 6);
          }
          ctx.globalAlpha = 0.3 + n.v * 0.6;
          if (this.low || !ctx.roundRect) ctx.fillRect(x + 1, top, keyW - 2, hgt);
          else { ctx.beginPath(); ctx.roundRect(x + 1, top, keyW - 2, hgt, radius); ctx.fill(); }
          if (n.time <= now && now < n.time + n.dur) active.set(n.m, ctx.fillStyle);
        }
      }
    }

    // ripples (masterpiece)
    if (this.ripples.length) {
      ctx.lineWidth = 1.5;
      for (const rp of this.ripples) {
        rp.age += dt;
        const k = rp.age / rp.life;
        if (k >= 1) continue;
        ctx.strokeStyle = rp.col;
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.beginPath();
        ctx.ellipse(rp.x, rp.y, rp.max * k, rp.max * k * 0.35, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
      if (this.frame % 10 === 0) this.ripples = this.ripples.filter((rp) => rp.age < rp.life);
    }

    // sparks (bright, masterpiece)
    if (this.particles.length) {
      for (const p of this.particles) {
        p.age += dt;
        const k = 1 - p.age / p.life;
        if (k <= 0) continue;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
        ctx.fillStyle = p.col;
        ctx.globalAlpha = k;
        ctx.fillRect(p.x, p.y, 2, 2);
      }
      if (this.frame % 10 === 0) this.particles = this.particles.filter((p) => p.age < p.life);
    }
    ctx.globalAlpha = 1;

    // keyboard: cached keys, then only the lit ones
    ctx.drawImage(this.keysCanvas, 0, hitY, w, this.keyH);
    ctx.globalAlpha = 0.95;
    for (const [m, col] of active) {
      ctx.fillStyle = col;
      ctx.fillRect((m - LOW) * keyW + 0.5, hitY + 2, keyW - 1, isBlack(m) ? this.keyH * 0.62 : this.keyH - 2);
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = th.css.rh;
    ctx.fillRect(0, hitY, w, 1);
    ctx.globalAlpha = 1;
  }
}

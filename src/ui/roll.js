// Falling-note piano roll with a different look per mode.
//  calm:        slow fall, soft glow, drifting dust, night-blue sky
//  bright:      warm gold, sparks burst from every note that lands
//  masterpiece: aurora ribbons overhead, ripples on every hit, jewel colours
const LOW = 28; // E1
const HIGH = 98; // D7
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

const THEMES = {
  calm: {
    seconds: 6,
    bg: ['#141a33', '#0b0e1c'],
    glow: 14,
    colors: {
      rh: [196, 186, 240], lh: [120, 150, 220], c2: [150, 200, 230], c3: [180, 160, 230], c4: [220, 220, 255],
      pad: [120, 120, 210], bass: [90, 100, 190], vln: [210, 190, 250], backing: [80, 130, 200],
    },
    dust: 60,
  },
  bright: {
    seconds: 4,
    bg: ['#2a1e1a', '#120d10'],
    glow: 8,
    colors: {
      rh: [245, 200, 110], lh: [240, 150, 90], c2: [250, 120, 110], c3: [255, 220, 150], c4: [255, 245, 210],
      pad: [240, 160, 100], bass: [200, 110, 80], vln: [255, 225, 160], backing: [220, 120, 70],
    },
    sparks: 6,
  },
  masterpiece: {
    seconds: 3.5,
    bg: ['#1a1030', '#07060f'],
    glow: 18,
    colors: {
      rh: [255, 210, 120], lh: [110, 140, 255], c2: [255, 120, 170], c3: [90, 220, 200], c4: [245, 245, 255],
      pad: [160, 110, 255], bass: [90, 80, 200], vln: [255, 190, 230], backing: [120, 90, 230],
    },
    ripples: true,
    aurora: true,
    sparks: 3,
  },
};

export class PianoRoll {
  constructor(canvas, getNow) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getNow = getNow;
    this.notes = [];
    this.particles = [];
    this.ripples = [];
    this.dust = [];
    this.keyPc = 2;
    this.setMode('calm');
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    const loop = (t) => { const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t; this.draw(dt, t / 1000); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setMode(mode) {
    this.mode = mode in THEMES ? mode : 'calm';
    this.theme = THEMES[this.mode];
    this.particles = [];
    this.ripples = [];
    document.body.dataset.mode = this.mode;
  }

  setKey(pc) { this.keyPc = pc; }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.keyH = Math.max(46, Math.min(80, this.h * 0.09));
    this.hitY = this.h - this.keyH;
    this.keyW = this.w / (HIGH - LOW + 1);
    this.dust = Array.from({ length: 70 }, () => ({ x: Math.random() * this.w, y: Math.random() * this.h, r: Math.random() * 1.6 + 0.4, s: Math.random() * 8 + 4, p: Math.random() * 6 }));
  }

  add(n) { this.notes.push(n); }

  _onHit(n, x) {
    const th = this.theme;
    const col = th.colors[n.voice] || th.colors.rh;
    if (n.inst !== 'piano' && n.inst !== 'backing') return;
    if (th.sparks) {
      const count = Math.round(th.sparks * (0.5 + n.v));
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const sp = 60 + Math.random() * 160 * n.v;
        this.particles.push({ x, y: this.hitY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.6, age: 0, col });
      }
    }
    if (th.ripples) this.ripples.push({ x, y: this.hitY, age: 0, life: 1.4, max: 30 + 90 * n.v, col });
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    if (this.ripples.length > 120) this.ripples.splice(0, this.ripples.length - 120);
  }

  draw(dt, t) {
    const { ctx, w, h, hitY, keyW, keyH } = this;
    const th = this.theme;
    const now = this.getNow();
    const pps = hitY / th.seconds;

    // background
    const g = ctx.createRadialGradient(w / 2, h * 0.2, 0, w / 2, h * 0.2, Math.max(w, h));
    g.addColorStop(0, th.bg[0]); g.addColorStop(0.7, th.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    if (th.aurora) this._aurora(t);
    if (th.dust) this._dust(dt, t);

    this.notes = this.notes.filter((n) => n.time + n.dur > now - 0.5);
    const active = new Map();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pass of ['strings', 'piano']) {
      for (const n of this.notes) {
        const isStr = n.inst !== 'piano';
        if ((pass === 'strings') !== isStr) continue;
        const y1 = hitY - (n.time - now) * pps;
        const y0 = y1 - n.dur * pps;
        const x = (n.m - LOW) * keyW;
        if (!n._hit && n.time <= now) { n._hit = true; this._onHit(n, x + keyW / 2); }
        if (y0 > hitY || y1 < 0) continue;
        const [r, gg, b] = th.colors[n.voice] || th.colors.rh;
        const top = Math.max(0, y0);
        const bot = Math.min(hitY, y1);
        if (isStr) {
          const wide = n.voice === 'vln' && this.mode === 'masterpiece' ? 2.2 : 4;
          ctx.fillStyle = `rgba(${r},${gg},${b},${0.05 + n.v * 0.12})`;
          ctx.fillRect(x - keyW * (wide - 1) / 2, top, keyW * wide, bot - top);
        } else {
          ctx.shadowColor = `rgb(${r},${gg},${b})`;
          ctx.shadowBlur = th.glow;
          ctx.fillStyle = `rgba(${r},${gg},${b},${0.3 + n.v * 0.6})`;
          roundRect(ctx, x + 1, top, keyW - 2, Math.max(2, bot - top), Math.min(5, keyW / 2.5));
          ctx.shadowBlur = 0;
        }
        if (n.time <= now && now < n.time + n.dur && !isStr) active.set(n.m, th.colors[n.voice] || th.colors.rh);
      }
    }

    // ripples (masterpiece)
    for (const rp of this.ripples) {
      rp.age += dt;
      const k = rp.age / rp.life;
      if (k >= 1) continue;
      ctx.strokeStyle = `rgba(${rp.col[0]},${rp.col[1]},${rp.col[2]},${0.5 * (1 - k)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.max * k, rp.max * k * 0.35, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((rp) => rp.age < rp.life);

    // sparks (bright, masterpiece)
    for (const p of this.particles) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
      const k = 1 - p.age / p.life;
      if (k <= 0) continue;
      ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${k})`;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    ctx.restore();

    // keyboard
    for (let m = LOW; m <= HIGH; m++) {
      const x = (m - LOW) * keyW;
      const col = active.get(m);
      if (col) ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
      else ctx.fillStyle = isBlack(m) ? 'rgba(20,22,36,0.95)' : 'rgba(225,220,205,0.16)';
      ctx.fillRect(x + 0.5, hitY + 2, keyW - 1, isBlack(m) ? keyH * 0.62 : keyH - 2);
    }
    const lc = th.colors.rh;
    ctx.fillStyle = `rgba(${lc[0]},${lc[1]},${lc[2]},0.4)`;
    ctx.fillRect(0, hitY, w, 1);
  }

  _dust(dt, t) {
    const { ctx } = this;
    for (const d of this.dust) {
      d.y -= d.s * dt;
      if (d.y < -5) { d.y = this.h + 5; d.x = Math.random() * this.w; }
      const a = 0.25 + 0.25 * Math.sin(t * 0.8 + d.p);
      ctx.fillStyle = `rgba(200,210,255,${a})`;
      ctx.beginPath(); ctx.arc(d.x + Math.sin(t * 0.3 + d.p) * 6, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // slow aurora ribbons, hue follows the key
  _aurora(t) {
    const { ctx, w } = this;
    const baseHue = (this.keyPc * 30 + 260) % 360;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const hue = (baseHue + i * 40 + Math.sin(t * 0.05 + i) * 20) % 360;
      ctx.beginPath();
      const yBase = this.h * (0.16 + i * 0.09);
      ctx.moveTo(0, yBase);
      for (let x = 0; x <= w; x += 24) {
        const y = yBase + Math.sin(x * 0.004 + t * (0.15 + i * 0.05) + i * 2) * 40 + Math.sin(x * 0.011 - t * 0.2) * 14;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, yBase + 140); ctx.lineTo(0, yBase + 140); ctx.closePath();
      const gr = ctx.createLinearGradient(0, yBase - 40, 0, yBase + 140);
      gr.addColorStop(0, `hsla(${hue},80%,65%,0.0)`);
      gr.addColorStop(0.3, `hsla(${hue},80%,65%,0.10)`);
      gr.addColorStop(1, `hsla(${hue},80%,50%,0)`);
      ctx.fillStyle = gr;
      ctx.fill();
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

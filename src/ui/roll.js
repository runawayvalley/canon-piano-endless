// Falling-note piano roll on a canvas. Notes fall onto a keyboard at the bottom.
const LOW = 28; // E1
const HIGH = 98; // D7
const COLORS = {
  rh: [231, 194, 125], lh: [127, 157, 227], c2: [227, 154, 168], c3: [127, 201, 194],
  pad: [170, 140, 230], bass: [120, 110, 200], vln: [240, 210, 160],
};
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);

export class PianoRoll {
  constructor(canvas, getNow) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getNow = getNow;
    this.notes = [];
    this.secondsVisible = 4;
    this.resize();
    addEventListener('resize', () => this.resize());
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.keyH = Math.max(46, Math.min(80, this.h * 0.09));
    this.hitY = this.h - this.keyH;
    this.keyW = this.w / (HIGH - LOW + 1);
  }

  add(n) { this.notes.push(n); }

  draw() {
    const { ctx, w, h, hitY, keyW, keyH } = this;
    const now = this.getNow();
    const pps = hitY / this.secondsVisible;
    ctx.clearRect(0, 0, w, h);
    this.notes = this.notes.filter((n) => n.time + n.dur > now - 0.5);
    const active = new Map();

    // strings first: wide soft bands behind the piano
    for (const pass of ['strings', 'piano']) {
      for (const n of this.notes) {
        const isStr = n.inst !== 'piano';
        if ((pass === 'strings') !== isStr) continue;
        const y1 = hitY - (n.time - now) * pps;
        const y0 = y1 - n.dur * pps;
        if (y0 > hitY || y1 < 0) continue;
        const x = (n.m - LOW) * keyW;
        const [r, g, b] = COLORS[n.voice] || COLORS.rh;
        const top = Math.max(0, y0);
        const bot = Math.min(hitY, y1);
        if (isStr) {
          ctx.fillStyle = `rgba(${r},${g},${b},${0.07 + n.v * 0.12})`;
          ctx.fillRect(x - keyW * 1.5, top, keyW * 4, bot - top);
        } else {
          ctx.fillStyle = `rgba(${r},${g},${b},${0.35 + n.v * 0.6})`;
          roundRect(ctx, x + 1, top, keyW - 2, Math.max(2, bot - top), Math.min(4, keyW / 3));
        }
        if (n.time <= now && now < n.time + n.dur && !isStr) active.set(n.m, COLORS[n.voice] || COLORS.rh);
      }
    }

    // keyboard
    for (let m = LOW; m <= HIGH; m++) {
      const x = (m - LOW) * keyW;
      const col = active.get(m);
      if (col) ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
      else ctx.fillStyle = isBlack(m) ? 'rgba(20,22,36,0.95)' : 'rgba(225,220,205,0.16)';
      ctx.fillRect(x + 0.5, hitY + 2, keyW - 1, isBlack(m) ? keyH * 0.62 : keyH - 2);
    }
    ctx.fillStyle = 'rgba(231,194,125,0.35)';
    ctx.fillRect(0, hitY, w, 1);
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

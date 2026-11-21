/**
 * 배경 장 — 점 격자, 빛 웅덩이, 번지는 물결.
 * 카드를 들면 커서를 따라 그 단계 색의 부드러운 빛이 번지고,
 * 놓는 순간 놓은 자리에서 색의 물결이 화면 끝까지 스르륵 퍼진다.
 * 물결 안쪽은 잠시 그 색으로 물들고, 띠가 지나가는 점 격자는 밝아지며 출렁인다.
 * 빛 띠는 위층 캔버스(sweep)에도 옅게 그려져 칸·카드 위로도 스친다.
 */
type RGB = [number, number, number];
interface Ripple { x: number; y: number; c: RGB; t: number; life: number; max: number; band: number; gain: number }
interface Pull { x: number; y: number; tx: number; ty: number; c: RGB; a: number; on: boolean }

const GAP = 24;
const rgb = (hex: string): RGB => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);   // 초반에 확 퍼지지 않고 고르게 감속한다

class Field {
  private back: HTMLCanvasElement | null = null;
  private top: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tctx: CanvasRenderingContext2D | null = null;
  private W = 0; private H = 0; private dots: number[] = [];
  private ripples: Ripple[] = []; private pull: Pull | null = null; private raf = 0;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private ro: ResizeObserver | null = null;
  private onResize = () => this.resize();
  /** 바깥에서 오는 좌표는 화면 기준(getBoundingClientRect·포인터)이다. 캔버스는
   *  이제 화면이 아니라 보드 상자를 덮으므로 상자 기준으로 옮긴다(#148). */
  private toLocal(x: number, y: number): [number, number] {
    const r = this.back?.getBoundingClientRect();
    return r ? [x - r.left, y - r.top] : [x, y];
  }

  mount(back: HTMLCanvasElement, top: HTMLCanvasElement) {
    this.back = back; this.top = top;
    this.ctx = back.getContext('2d'); this.tctx = top.getContext('2d');
    if (!this.ctx || !this.tctx) return;
    addEventListener('resize', this.onResize);
    // 콘솔 안에서는 창이 아니라 보드 상자의 크기를 따라간다 — 레일이 접히거나
    // 프레임이 달라질 때 창 resize 는 일어나지 않는다(#148)
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(this.onResize) : null;
    this.ro?.observe(back);
    this.resize();
  }
  unmount() { removeEventListener('resize', this.onResize); this.ro?.disconnect(); this.ro = null; cancelAnimationFrame(this.raf); this.raf = 0; this.back = this.top = null; this.ctx = this.tctx = null; }

  private resize() {
    if (!this.back || !this.top || !this.ctx || !this.tctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = this.back.clientWidth || innerWidth; this.H = this.back.clientHeight || innerHeight;
    for (const cv of [this.back, this.top]) { cv.width = this.W * dpr; cv.height = this.H * dpr; }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dots = [];
    for (let y = GAP / 2; y < this.H; y += GAP) for (let x = GAP / 2; x < this.W; x += GAP) this.dots.push(x, y);
    this.draw(performance.now());
  }

  private draw(now: number) {
    const ctx = this.ctx, tctx = this.tctx;
    if (!ctx || !tctx) return;
    const { W, H } = this;
    ctx.clearRect(0, 0, W, H); tctx.clearRect(0, 0, W, H);
    this.ripples = this.ripples.filter((r) => now - r.t < r.life);
    const waves = this.ripples.map((r) => {
      const age = (now - r.t) / r.life;
      return { r, w: age < 0 || age >= 1 ? null : { rad: easeOut(age) * r.max, fade: Math.pow(1 - age, 1.6), band: r.band * (0.7 + 0.6 * age) } };
    });

    ctx.globalCompositeOperation = 'lighter';
    for (const { r, w } of waves) {
      if (!w) continue;
      const wash = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, Math.max(1, w.rad));
      wash.addColorStop(0, rgba(r.c, 0.11 * w.fade * r.gain));
      wash.addColorStop(0.75, rgba(r.c, 0.05 * w.fade * r.gain));
      wash.addColorStop(1, rgba(r.c, 0));
      ctx.fillStyle = wash; ctx.fillRect(0, 0, W, H);
      const inner = Math.max(0, w.rad - w.band), outer = w.rad + w.band * 0.55;
      for (const [c2, a] of [[ctx, 0.24], [tctx, 0.13]] as const) {
        const edge = c2.createRadialGradient(r.x, r.y, inner, r.x, r.y, outer);
        edge.addColorStop(0, rgba(r.c, 0));
        edge.addColorStop(0.64, rgba(r.c, a * w.fade * r.gain));
        edge.addColorStop(1, rgba(r.c, 0));
        c2.fillStyle = edge; c2.fillRect(0, 0, W, H);
      }
    }
    const p = this.pull;
    if (p && p.a > 0.01) {
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 280);
      glow.addColorStop(0, rgba(p.c, 0.17 * p.a));
      glow.addColorStop(0.5, rgba(p.c, 0.06 * p.a));
      glow.addColorStop(1, rgba(p.c, 0));
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';

    const dots = this.dots;
    for (let i = 0; i < dots.length; i += 2) {
      const x = dots[i], y = dots[i + 1];
      let a = 0.07, sz = 1.1, dx = 0, dy = 0, col: RGB | null = null, best = 0;
      if (p && p.a > 0.01) {
        const px = p.x - x, py = p.y - y;
        const k = Math.exp(-(px * px + py * py) / (160 * 160)) * p.a;
        if (k > 0.01) { a += k * 0.5; sz += k * 1.2; dx += px * k * 0.05; dy += py * k * 0.05; col = p.c; best = k; }
      }
      for (const { r, w } of waves) {
        if (!w) continue;
        const qx = x - r.x, qy = y - r.y, d = Math.sqrt(qx * qx + qy * qy) || 1;
        const s = d - w.rad;
        const k = Math.exp(-(s * s) / (w.band * w.band)) * w.fade * r.gain;
        if (k < 0.01) continue;
        a += k * 0.8; sz += k * 1.6;
        const wob = Math.sin(s / 18) * k * 5;
        dx += (qx / d) * wob; dy += (qy / d) * wob;
        if (k > best) { col = r.c; best = k; }
      }
      ctx.fillStyle = col && best > 0.04 ? rgba(col, a) : `rgba(170,178,255,${a.toFixed(3)})`;
      ctx.fillRect(x + dx - sz / 2, y + dy - sz / 2, sz, sz);
    }
  }

  private loop = (now: number) => {
    const p = this.pull;
    if (p) {
      p.x += (p.tx - p.x) * 0.22; p.y += (p.ty - p.y) * 0.22;
      p.a += ((p.on ? 1 : 0) - p.a) * (p.on ? 0.12 : 0.07);
      if (!p.on && p.a < 0.01) this.pull = null;
    }
    this.draw(now);
    this.raf = this.pull || this.ripples.length ? requestAnimationFrame(this.loop) : 0;
    if (!this.raf) this.draw(now);
  };
  private kick() { if (!this.raf && !this.reduced && !document.hidden && this.ctx) this.raf = requestAnimationFrame(this.loop); }

  /** 카드를 들고 있는 동안 — 커서를 따라가는 빛 웅덩이 (칸을 옮겨 다니면 색도 스르륵 바뀐다) */
  attract(vx: number, vy: number, hex: string) {
    if (this.reduced) return;
    const [x, y] = this.toLocal(vx, vy);
    const c = rgb(hex);
    if (!this.pull) this.pull = { x, y, tx: x, ty: y, c, a: 0, on: true };
    const p = this.pull;
    p.tx = x; p.ty = y; p.on = true;
    p.c = p.c.map((v, i) => Math.round(v + (c[i] - v) * 0.2)) as RGB;
    this.kick();
  }
  release() { if (this.pull) this.pull.on = false; this.kick(); }
  /** 놓은 자리에서 번지는 물결 — strong 이면 화면 끝까지 */
  ripple(vx: number, vy: number, hex: string, strong = true) {
    const [x, y] = this.toLocal(vx, vy);
    if (this.reduced) return;
    const now = performance.now(), c = rgb(hex), far = Math.hypot(this.W, this.H);
    if (strong) {
      this.ripples.push({ x, y, c, t: now, life: 2800, max: far * 1.05, band: 170, gain: 1 });
      this.ripples.push({ x, y, c, t: now + 320, life: 3000, max: far * 0.95, band: 100, gain: 0.55 });
    } else {
      this.ripples.push({ x, y, c, t: now, life: 1500, max: far * 0.4, band: 80, gain: 0.6 });
    }
    this.kick();
  }
}

export const field = new Field();

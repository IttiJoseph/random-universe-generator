import { Grid, clamp, mix, mulberry32, smooth } from "./engine";
import { OBJECT_IDS } from "./types";
import type { Def, Item, ObjectId, Palette, SceneConfig, SceneView, StarOut } from "./types";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
type Star = { x: number; y: number; ph: number; sp: number; b: number; tint: number };

/** Most objects of one kind the controls allow. */
export const MAX_PER_TYPE = 10;
/** Star candidates sit one per cell of this size: the densest the starfield can get (40 per 100k px²). */
const STAR_CELL = 50;
const STAR_SCALE = [0.9, 1, 1.15]; // glyph size per star kind: . + *
const STAR_GLYPH = [".", "+", "*"];
/** The bloom is painted at 1/3 size, then scaled up and softened. */
const BLOOM_SCALE = 3;

/**
 * The whole universe: a grid of ASCII glyphs over the viewport, a starfield, and the special objects
 * scattered through it. Everything is in "page" coordinates; here the page is simply the canvas.
 */
export class Scene implements SceneView {
  cfg: SceneConfig;
  seed = 1;
  /** Where the moving objects roam (the hero), page px. */
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  W = 0;
  H = 0;
  /** Shrinks objects and the text buffer on narrow screens. */
  scale = 1;
  /** Nothing is drawn below this viewport y: the end of the page, so the sticky footer shows clean as it is revealed. */
  clipBottom = Infinity;
  pageW = 0;
  pageH = 0;
  vw = 0;
  vh = 0;
  dpr = 1;
  scrollY = 0;
  reduced = false;
  fontFamily = "monospace";
  readonly g = new Grid();
  items: Item[] = [];

  private t = 0;
  private exclude: Rect | null = null;
  private hero: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private groups = Object.fromEntries(OBJECT_IDS.map((id) => [id, [] as Item[]])) as Record<ObjectId, Item[]>;
  private slots = Object.fromEntries(OBJECT_IDS.map((id) => [id, [] as { x: number; y: number }[]])) as Record<ObjectId, { x: number; y: number }[]>;
  private starsByKind: Star[][] = [[], [], []];
  private ready = false;
  private glowCells: number[] = [];
  private bloomCanvas: HTMLCanvasElement | null = null;
  private bloomCtx: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly defs: Def[],
    private readonly C: Palette,
    cfg: SceneConfig,
  ) {
    this.cfg = cfg;
  }

  /* ───────── setup ───────── */

  setViewport(vw: number, vh: number, dpr: number) {
    this.vw = vw;
    this.vh = vh;
    this.dpr = dpr;
    this.scale = clamp(vw / 1280, 0.5, 1);
    this.g.resize(vw, vh, this.cfg.glyph);
  }

  setLayout(pageW: number, pageH: number, hero: Rect, exclude: Rect | null) {
    this.pageW = pageW;
    this.pageH = pageH;
    this.hero = hero;
    this.exclude = exclude;
    this.x0 = hero.x0;
    this.y0 = hero.y0;
    this.x1 = hero.x1;
    this.y1 = hero.y1;
    this.W = Math.max(1, hero.x1 - hero.x0);
    this.H = Math.max(1, hero.y1 - hero.y0);
    this.buildSlots();
    this.rebuildStars();
    this.ready = true;
    this.syncCounts(); // narrow screens get fewer objects
    this.relocate();
  }

  setConfig(next: SceneConfig) {
    const prev = this.cfg;
    this.cfg = next;
    if (next.glyph !== prev.glyph && this.vw) this.g.resize(this.vw, this.vh, next.glyph);
    if (JSON.stringify(next.stars) !== JSON.stringify(prev.stars)) this.rebuildStars();
    if (this.ready) {
      if (next.stars.textBuffer !== prev.stars.textBuffer) {
        this.buildSlots();
        this.relocate();
      }
      this.syncCounts();
    }
  }

  /** How many ambient stars are in the sky right now. */
  get starCount() {
    return this.starsByKind[0].length + this.starsByKind[1].length + this.starsByKind[2].length;
  }

  /** The headline's breathing room, grown by `pad`. Moving objects steer clear of it. */
  zone(pad: number): Rect | null {
    const e = this.exclude;
    if (!e) return null;
    const m = this.cfg.stars.textBuffer * this.scale * 0.35 + pad;
    return { x0: e.x0 - m, y0: e.y0 - m * 0.7, x1: e.x1 + m, y1: e.y1 + m * 0.7 };
  }

  /* ───────── placement ───────── */

  /** Best-candidate scatter across the hero, steering clear of the headline, round-robin over the kinds so they mix. */
  private buildSlots() {
    const rng = mulberry32(this.seed * 977 + 13);
    const placed: { x: number; y: number; r: number }[] = [];
    const inset = 40;
    const room = this.cfg.stars.textBuffer * this.scale * 0.45;
    const ex = this.exclude && { x0: this.exclude.x0 - room, y0: this.exclude.y0 - room * 0.7, x1: this.exclude.x1 + room, y1: this.exclude.y1 + room * 0.7 };
    for (const id of OBJECT_IDS) this.slots[id] = [];
    for (let k = 0; k < MAX_PER_TYPE; k++) {
      for (const d of this.defs) {
        const r = this.cfg.objects[d.id].size * this.scale * 0.6;
        let best = { x: this.x0 + this.W / 2, y: this.y0 + this.H / 2 };
        let bd = -1e9;
        // Pass 0 keeps clear of the headline. On a screen too narrow for that, pass 1 just spreads things out.
        for (let pass = 0; pass < 2 && bd === -1e9; pass++) {
          for (let c = 0; c < 30; c++) {
            const x = this.x0 + inset + rng() * Math.max(1, this.W - 2 * inset);
            const y = this.y0 + inset + rng() * Math.max(1, this.H - 2 * inset);
            if (pass === 0 && ex && x > ex.x0 - r && x < ex.x1 + r && y > ex.y0 - r && y < ex.y1 + r) continue;
            let dmin = 1e9;
            for (const o of placed) dmin = Math.min(dmin, Math.hypot(x - o.x, y - o.y) - o.r - r);
            if (dmin > bd) {
              bd = dmin;
              best = { x, y };
            }
          }
        }
        this.slots[d.id].push(best);
        placed.push({ ...best, r });
      }
    }
  }

  private makeItem(def: Def, i: number): Item {
    const rng = mulberry32(this.seed * 131 + OBJECT_IDS.indexOf(def.id) * 7919 + i * 104729 + 11);
    const slot = this.slots[def.id][i];
    const it: Item = { def, i, p: null, s: null, x: slot.x, y: slot.y, a: 0, k: 0, awake: false, ck: 0, hov: 0, hovering: false };
    it.p = def.spawn(rng, i, this);
    it.s = def.init(it, this);
    return it;
  }

  private syncCounts() {
    for (const d of this.defs) {
      const list = this.groups[d.id];
      const n = Math.round(this.cfg.objects[d.id].count * clamp((this.vw - 360) / 640, 0.5, 1)); // fewer on phones
      if (list.length > n) list.length = n;
      while (list.length < n) list.push(this.makeItem(d, list.length));
    }
    this.items = this.defs.flatMap((d) => this.groups[d.id]);
  }

  private relocate() {
    for (const it of this.items) {
      const slot = this.slots[it.def.id][it.i];
      it.x = slot.x;
      it.y = slot.y;
      if (!it.awake) it.s = it.def.init(it, this);
    }
  }

  /* ───────── stars ───────── */

  /** Sparse across the hero; below it only along the side edges, thinning toward the middle. */
  private rebuildStars() {
    const { hero, edge, edgeWidth } = this.cfg.stars;
    const textBuffer = this.cfg.stars.textBuffer * this.scale;
    const rng = mulberry32(7919 + this.seed * 31);
    const by: Star[][] = [[], [], []];
    const ex = this.exclude;
    const cols = Math.ceil(this.pageW / STAR_CELL);
    const rows = Math.ceil(this.pageH / STAR_CELL);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = (gx + rng()) * STAR_CELL;
        const y = (gy + rng()) * STAR_CELL;
        const u = rng();
        const kr = rng();
        const star: Star = { x, y, ph: rng() * Math.PI * 2, sp: 0.6 + rng() * 1.8, b: 0.26 + rng() * 0.5, tint: rng() };
        const kind = kr < 0.62 ? 0 : kr < 0.88 ? 1 : 2;
        const pHero = (hero / 40) * smooth(this.hero.y1 + 220, this.hero.y1, y);
        const edgeDist = Math.min(x, this.pageW - x) / this.pageW;
        const pEdge = (edge / 40) * smooth(edgeWidth, 0, edgeDist);
        let p = Math.max(pHero, pEdge);
        if (ex) {
          // the sky goes quiet around the headline: none behind the words, then a slow ramp back to normal
          const d = Math.hypot(Math.max(ex.x0 - x, 0, x - ex.x1), Math.max(ex.y0 - y, 0, y - ex.y1));
          if (d === 0) continue;
          if (textBuffer > 0) p *= 0.06 + 0.94 * smooth(0, textBuffer, d);
        }
        if (u >= p) continue;
        by[kind].push(star);
      }
    }
    this.starsByKind = by;
  }

  /* ───────── interaction ───────── */

  private hitTest(x: number, y: number): Item | null {
    for (let n = this.items.length - 1; n >= 0; n--) {
      const it = this.items[n];
      if (!it.awake && it.def.hit(it, this, x, y)) return it;
    }
    return null;
  }
  /** Returns true when the pointer is over something that can be woken. */
  hover(x: number, y: number) {
    const h = this.hitTest(x, y);
    for (const it of this.items) it.hovering = it === h;
    return !!h;
  }
  unhover() {
    for (const it of this.items) it.hovering = false;
  }
  click(x: number, y: number) {
    const h = this.hitTest(x, y);
    if (h) h.awake = true;
    return !!h;
  }
  wakeAll() {
    for (const it of this.items) it.awake = true;
  }
  resetAll() {
    for (const it of this.items) {
      it.a = 0;
      it.k = 0;
      it.awake = false;
      it.ck = 0;
      it.s = it.def.init(it, this);
    }
  }
  /** Re-rolls where things sit and how each one varies. */
  shuffle() {
    this.setSeed(this.seed + 1);
  }
  /** The same seed always lays out the same universe (for the same settings and screen size). */
  setSeed(seed: number) {
    this.seed = seed;
    for (const id of OBJECT_IDS) this.groups[id].length = 0;
    this.buildSlots();
    this.rebuildStars();
    this.syncCounts();
  }

  /* ───────── frame ───────── */

  frame(dtReal: number, ctx: CanvasRenderingContext2D) {
    const motion = this.reduced ? 0 : 1;
    const gdt = dtReal * motion * this.cfg.speed;
    this.t += gdt;
    const t = this.t;
    for (const it of this.items) {
      if (it.awake) it.a = Math.min(1, it.a + dtReal / 1.1);
      it.k = smooth(0, 1, it.a);
      const dt = gdt * this.cfg.objects[it.def.id].speed;
      it.ck += dt * it.k;
      it.hov += ((it.hovering && !it.awake ? 1 : 0) - it.hov) * Math.min(1, dtReal * 10);
      if (this.reduced && it.awake && it.def.id === "blackhole") it.s.pull = 1; // no motion: jump straight to the pulled-in state
      it.def.update(it, this, dt, t, it.k);
    }

    const g = this.g;
    g.clear();
    const snapY = Math.floor(this.scrollY / g.chh) * g.chh; // whole rows, so glyphs don't shimmer as the page scrolls
    g.setOffset(0, snapY);
    for (const it of this.items) {
      g.gain = 1 + it.hov * 0.5 * (1 - it.k) * (0.55 + 0.45 * Math.sin(t * 11));
      g.glow = (it.def.bloom ?? 0) * it.k; // only awake objects glow
      it.def.draw(it, this, g, t, it.k);
    }
    g.gain = 1;
    g.glow = 0;
    this.render(ctx, t, snapY);
  }

  private render(ctx: CanvasRenderingContext2D, t: number, snapY: number) {
    const g = this.g;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    const clipped = this.clipBottom < this.vh;
    if (clipped) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.vw, Math.max(0, this.clipBottom));
      ctx.clip();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.drawStars(ctx, t);
    ctx.font = `${g.fs}px ${this.fontFamily}`;
    const shift = this.scrollY - snapY;
    const glow = this.glowCells;
    glow.length = 0;
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        const k = j * g.cols + i;
        const I = g.I[k];
        if (I < 0.05) continue;
        const c = g.C[k];
        if (c === " ") continue;
        ctx.fillStyle = `rgba(${g.R[k]},${g.G[k]},${g.B[k]},${Math.min(1, 0.3 + I * 0.9).toFixed(2)})`;
        ctx.fillText(c, (i + 0.5) * g.cw, (j + 0.5) * g.chh - shift);
        if (g.GL[k] > 0.02) glow.push(k);
      }
    }
    this.drawBloom(ctx, shift);
    if (clipped) ctx.restore();
  }

  /** A soft glow behind the bright glyphs of awake galaxies, comets, pulsars and black holes. */
  private drawBloom(ctx: CanvasRenderingContext2D, shift: number) {
    const cells = this.glowCells;
    if (!cells.length || this.cfg.bloom <= 0) return;
    if (!this.bloomCanvas) {
      this.bloomCanvas = document.createElement("canvas");
      this.bloomCtx = this.bloomCanvas.getContext("2d");
    }
    const cv = this.bloomCanvas;
    const b = this.bloomCtx;
    if (!b) return;
    const S = BLOOM_SCALE;
    const w = Math.ceil(this.vw / S);
    const h = Math.ceil(this.vh / S);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    } else {
      b.clearRect(0, 0, w, h);
    }
    const g = this.g;
    const half = (Math.max(g.cw, g.chh) * 1.6) / S;
    b.globalCompositeOperation = "lighter";
    for (const k of cells) {
      const j = Math.floor(k / g.cols);
      const i = k - j * g.cols;
      const a = Math.min(1, g.I[k] * g.GL[k] * 0.5);
      b.fillStyle = `rgba(${g.R[k]},${g.G[k]},${g.B[k]},${a.toFixed(3)})`;
      b.fillRect(((i + 0.5) * g.cw) / S - half, ((j + 0.5) * g.chh - shift) / S - half, half * 2, half * 2);
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = clamp(this.cfg.bloom);
    ctx.filter = `blur(${3 * this.dpr}px)`;
    ctx.drawImage(cv, 0, 0, this.vw, this.vh);
    ctx.restore();
  }

  private drawStars(ctx: CanvasRenderingContext2D, t: number) {
    const { twinkle, tint } = this.cfg.stars;
    const size = this.cfg.stars.size * Math.max(0.75, this.scale);
    const C = this.C;
    const fx = this.items.filter((it) => it.def.starFx && it.k > 0.001);
    const out: StarOut = { x: 0, y: 0, boost: 0, tint: C.ice, ch: null };
    const top = this.scrollY - 24;
    const bottom = this.scrollY + this.vh + 24;
    const amp = clamp(twinkle) * 0.5;
    for (let kind = 0; kind < 3; kind++) {
      ctx.font = `${size * STAR_SCALE[kind]}px ${this.fontFamily}`;
      for (const s of this.starsByKind[kind]) {
        if (s.y < top - 220 || s.y > bottom + 220) continue; // lenses and rings can move a star, so the margin is generous
        out.x = s.x;
        out.y = s.y;
        out.boost = 0;
        out.tint = C.ice;
        out.ch = null;
        for (const it of fx) it.def.starFx!(it, this, s, out, t, it.k);
        if (out.y < top || out.y > bottom || this.g.solidAt(out.x, out.y)) continue;
        const I = s.b * (1 - amp + amp * Math.sin(t * s.sp + s.ph)) + out.boost * 0.9;
        let col = s.tint < tint * 0.5 ? C.ember : s.tint < tint ? C.sky : mix(C.dust, C.white, s.b);
        if (out.boost > 0.05) col = mix(col, out.tint, clamp(out.boost * 1.4));
        const ch = out.ch ?? (out.boost > 0.45 && kind === 0 ? "+" : STAR_GLYPH[kind]);
        ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${Math.min(1, 0.3 + Math.min(1, I) * 0.9).toFixed(2)})`;
        ctx.fillText(ch, out.x, out.y - this.scrollY);
      }
    }
  }
}

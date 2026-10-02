import type { Palette, PaletteKey, RGB, Rng, Stops } from "./types";

export const TAU = Math.PI * 2;
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Stable pseudo-random value for a pair of numbers (same input, same output). */
export const hash = (x: number, y: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
export const mulberry32 = (seed: number): Rng => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[(rng() * arr.length) | 0];
export const wrapPi = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const ramp = (stops: Stops, t: number): RGB => {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      return mix(c0, c1, (t - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
};

/* ───────── palette: read from the CSS tokens in globals.css ───────── */

const parseColor = (v: string): RGB => {
  const m = v.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const TOKEN: Record<Exclude<PaletteKey, "black">, string> = {
  ember: "--color-cosmos-ember",
  amber: "--color-cosmos-amber",
  cream: "--color-cosmos-cream",
  sky: "--color-cosmos-sky",
  ice: "--color-cosmos-ice",
  rust: "--color-cosmos-rust",
  deep: "--color-cosmos-deep",
  cyan: "--color-cosmos-cyan",
  dust: "--color-cosmos-dust",
  white: "--color-paper",
};

export function readPalette(root: HTMLElement): Palette {
  const cs = getComputedStyle(root);
  const out = { black: [0, 0, 0] } as Palette;
  for (const key of Object.keys(TOKEN) as (keyof typeof TOKEN)[]) out[key] = parseColor(cs.getPropertyValue(TOKEN[key]));
  return out;
}

/* ───────── glyph helpers ───────── */

const RAMP = " .:-=+*#%@";
export const rampCh = (I: number) => RAMP[Math.min(9, (I * 10) | 0)];

// Organic stipple: a mix of glyphs per brightness band, picked by a stable per-cell hash.
const CH_BANDS = [
  [".", "'", ",", "`", ":", "."],
  [";", ":", "!", "^", ",", "+"],
  ["*", "+", "!", "c", "o", ";"],
  ["O", "o", "c", "*", "0", "+"],
  ["@", "#", "O", "0", "@", "%"],
];
export const pickCh = (I: number, h: number) => {
  const b = CH_BANDS[Math.min(4, (I * 5) | 0)];
  return b[(h * b.length) | 0];
};

/** Glyph that follows a direction (y down). */
export const lineCh = (dx: number, dy: number) => {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  const d = (a * 180) / Math.PI;
  if (d < 22.5 || d > 157.5) return "-";
  if (d > 67.5 && d < 112.5) return "|";
  return d < 90 ? "\\" : "/";
};

/** Glyph on the rim of a circle, by direction from its centre (y down). */
export const circleCh = (dx: number, dy: number) => {
  const d = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (Math.abs(d) < 22.5) return ")";
  if (Math.abs(d) > 157.5) return "(";
  if (d < 0) return d > -67.5 ? "\\" : d > -112.5 ? "-" : "/";
  return d < 67.5 ? "/" : d < 112.5 ? "_" : "\\";
};

/** Distance (px) from a point inside an ellipse to its rim, so outlines stay one cell thick at any size. */
export const ellDist = (u: number, w: number, a: number, b: number, R: number) => {
  const e = Math.hypot(u / a, w / b);
  if (e > 1) return -1;
  const gm = Math.hypot(u / (a * a), w / (b * b)) / Math.max(e, 1e-6);
  return ((1 - e) / Math.max(gm, 1e-6)) * R;
};

/* ───────── ASCII grid ─────────
   A grid of glyph cells covering the viewport. Objects draw in page coordinates; the grid is
   offset by the scroll position (snapped to whole rows so glyphs don't shimmer while scrolling). */

export type CellFn = (px: number, py: number, i: number, j: number) => void;

export class Grid {
  gain = 1;
  /** Glow strength stamped on every cell written while it is set; the scene turns it on per object. */
  glow = 0;
  fs = 4.5;
  cw = 2.7;
  chh = 3.7;
  cols = 0;
  rows = 0;
  offX = 0;
  offY = 0;
  I = new Float32Array(0);
  R = new Uint8Array(0);
  G = new Uint8Array(0);
  B = new Uint8Array(0);
  /** Cells covered by a solid object (stars behind them are hidden). */
  S = new Uint8Array(0);
  /** Per-cell glow, for the bloom pass. */
  GL = new Float32Array(0);
  C: string[] = [];

  resize(w: number, h: number, fs: number) {
    this.fs = fs;
    this.cw = fs * 0.6;
    this.chh = fs * 0.82;
    this.cols = Math.ceil(w / this.cw);
    this.rows = Math.ceil(h / this.chh) + 2;
    const n = this.cols * this.rows;
    this.I = new Float32Array(n);
    this.R = new Uint8Array(n);
    this.G = new Uint8Array(n);
    this.B = new Uint8Array(n);
    this.S = new Uint8Array(n);
    this.GL = new Float32Array(n);
    this.C = new Array(n).fill(" ");
  }
  clear() {
    this.I.fill(0);
    this.S.fill(0);
    this.GL.fill(0);
  }
  setOffset(x: number, y: number) {
    this.offX = x;
    this.offY = y;
  }
  private set(k: number, I: number, col: RGB, c?: string) {
    this.I[k] = I;
    this.R[k] = col[0];
    this.G[k] = col[1];
    this.B[k] = col[2];
    this.GL[k] = this.glow;
    this.C[k] = c || rampCh(I);
  }
  /** Keeps the brighter of two writers. */
  plotCell(i: number, j: number, I: number, col: RGB, c?: string) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    I = Math.min(1, I * this.gain);
    if (I < 0.05) return;
    const k = j * this.cols + i;
    if (I > this.I[k]) this.set(k, I, col, c);
  }
  plot(x: number, y: number, I: number, col: RGB, c?: string) {
    this.plotCell(Math.floor((x - this.offX) / this.cw), Math.floor((y - this.offY) / this.chh), I, col, c);
  }
  /** Solid: overrides whatever is behind it (planet body, hulls…). */
  put(i: number, j: number, I: number, col: RGB, c?: string) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    I = Math.min(1, Math.max(0.12, I * this.gain));
    const k = j * this.cols + i;
    this.set(k, I, col, c);
    this.S[k] = 1;
  }
  putXY(x: number, y: number, I: number, col: RGB, c?: string) {
    this.put(Math.floor((x - this.offX) / this.cw), Math.floor((y - this.offY) / this.chh), I, col, c);
  }
  erase(i: number, j: number) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return;
    const k = j * this.cols + i;
    this.I[k] = 0;
    this.S[k] = 1;
    this.GL[k] = 0;
  }
  solidAt(x: number, y: number) {
    const i = Math.floor((x - this.offX) / this.cw);
    const j = Math.floor((y - this.offY) / this.chh);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return false;
    return this.S[j * this.cols + i] === 1;
  }
  /** Visits every cell whose centre falls in the box, with the centre in page px. */
  each(x0: number, y0: number, x1: number, y1: number, fn: CellFn) {
    const i0 = Math.max(0, Math.floor((x0 - this.offX) / this.cw));
    const i1 = Math.min(this.cols - 1, Math.floor((x1 - this.offX) / this.cw));
    const j0 = Math.max(0, Math.floor((y0 - this.offY) / this.chh));
    const j1 = Math.min(this.rows - 1, Math.floor((y1 - this.offY) / this.chh));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) fn(this.offX + (i + 0.5) * this.cw, this.offY + (j + 0.5) * this.chh, i, j);
    }
  }
}

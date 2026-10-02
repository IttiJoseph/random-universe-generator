import { DEFAULT_CONFIG } from "./universe/config";
import { mulberry32, readPalette } from "./universe/engine";
import { buildObjects } from "./universe/objects";
import { Scene } from "./universe/scene";
import { OBJECT_IDS } from "./universe/types";
import type { SceneConfig } from "./universe/types";
import { clampSeed, configFromSeed, randomSeed } from "./random";

export type AppState = {
  seed: number;
  config: SceneConfig;
  /** Share of objects that start awake in a freshly generated universe, 0..1. */
  wakeShare: number;
  autopilot: boolean;
  /** True once the settings have been changed by hand, so a shared link has to carry them. */
  dirty: boolean;
};

const DEFAULT_WAKE = 0.35;

/** Owns the scene: the canvas, the animation loop, the seed, and what the controls change. */
export class App {
  readonly scene: Scene;
  readonly state: AppState;
  fps = 60;

  private listeners = new Set<() => void>();
  private autoTimer = 0;
  private autoIdle = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const palette = readPalette(document.documentElement);
    const shared = readHash();
    const seed = shared.seed ?? randomSeed();
    this.state = {
      seed,
      config: shared.config ?? configFromSeed(seed),
      wakeShare: shared.wake ?? DEFAULT_WAKE,
      autopilot: false,
      dirty: !!shared.config,
    };
    this.scene = new Scene(buildObjects(palette), palette, this.state.config);
    this.scene.fontFamily = '"Space Mono", ui-monospace, Menlo, Consolas, monospace';
    document.fonts?.load('12px "Space Mono"').catch(() => {});

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.scene.reduced = motion.matches;
    motion.addEventListener("change", () => (this.scene.reduced = motion.matches));
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /* ───────── running ───────── */

  start() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const r = this.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.scene.setViewport(w, h, dpr);
      this.scene.setLayout(w, h, { x0: 0, y0: 0, x1: w, y1: h }, null);
    };
    resize();
    this.generate(this.state.seed, this.state.dirty ? this.state.config : undefined);
    new ResizeObserver(resize).observe(this.canvas);

    // Hover and click are matched to objects in canvas coordinates.
    this.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = this.canvas.getBoundingClientRect();
      this.canvas.style.cursor = this.scene.hover(e.clientX - r.left, e.clientY - r.top) ? "pointer" : "";
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.scene.unhover();
      this.canvas.style.cursor = "";
    });
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      if (this.scene.click(e.clientX - r.left, e.clientY - r.top)) this.emit();
    });

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
      this.scene.frame(dt, ctx);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ───────── making a universe ───────── */

  /** Builds the universe for a seed. With a config the settings come from it; without, they come from the seed. */
  generate(seed: number, config?: SceneConfig) {
    const s = this.state;
    s.seed = clampSeed(seed);
    s.config = config ?? configFromSeed(s.seed);
    s.dirty = !!config;
    this.scene.setConfig(s.config);
    this.scene.setSeed(s.seed);

    // wake a seeded share of the objects, so the first look already has some colour in it
    const rng = mulberry32(s.seed * 31 + 7);
    const items = [...this.scene.items].sort(() => rng() - 0.5);
    items.slice(0, Math.round(items.length * s.wakeShare)).forEach((it) => (it.awake = true));

    this.autoIdle = 0;
    this.writeHash();
    this.emit();
  }
  randomize() {
    this.generate(randomSeed());
  }
  step(delta: number) {
    this.generate(this.state.seed + delta);
  }

  /** A hand-made change to the settings. */
  patchConfig(fn: (c: SceneConfig) => SceneConfig) {
    this.state.config = fn(this.state.config);
    this.state.dirty = true;
    this.scene.setConfig(this.state.config);
    this.writeHash();
    this.emit();
  }
  setWakeShare(v: number) {
    this.state.wakeShare = v;
    this.writeHash();
    this.emit();
  }

  wakeAll() {
    this.scene.wakeAll();
    this.emit();
  }
  sleepAll() {
    this.scene.resetAll();
    this.emit();
  }

  /** Autopilot wakes the sky one object at a time, rests a moment, then flies to a new universe. */
  setAutopilot(on: boolean) {
    this.state.autopilot = on;
    window.clearInterval(this.autoTimer);
    this.autoIdle = 0;
    if (on) {
      this.autoTimer = window.setInterval(() => {
        const asleep = this.scene.items.filter((it) => !it.awake);
        if (asleep.length) {
          asleep[Math.floor(Math.random() * asleep.length)].awake = true;
          this.autoIdle = 0;
        } else if (++this.autoIdle >= 4) {
          this.randomize();
        }
        this.emit();
      }, 2200);
    }
    this.emit();
  }

  /** Saves the current view as a PNG, on a dark background. */
  snapshot() {
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const c = out.getContext("2d");
    if (!c) return;
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--screen").trim() || "#0d0b17";
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(this.canvas, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `universe-${String(this.state.seed).padStart(6, "0")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  async copyLink() {
    this.writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      return true;
    } catch {
      return false;
    }
  }

  /* ───────── the link ───────── */

  /** The address always describes the current universe: the seed, plus the settings once they've been changed by hand. */
  private writeHash() {
    const s = this.state;
    const p = new URLSearchParams();
    p.set("seed", String(s.seed));
    if (s.dirty) p.set("c", btoa(JSON.stringify(s.config)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    if (s.wakeShare !== DEFAULT_WAKE) p.set("w", String(Math.round(s.wakeShare * 100)));
    history.replaceState(null, "", `#${p.toString()}`);
  }
}

/* Reads a shared link. Anything missing or malformed is simply ignored. */
function readHash(): { seed?: number; config?: SceneConfig; wake?: number } {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: { seed?: number; config?: SceneConfig; wake?: number } = {};
  const seed = Number(p.get("seed"));
  if (p.has("seed") && Number.isFinite(seed)) out.seed = clampSeed(seed);
  const w = Number(p.get("w"));
  if (p.has("w") && Number.isFinite(w)) out.wake = Math.min(1, Math.max(0, w / 100));
  const c = p.get("c");
  if (c) {
    try {
      const raw = JSON.parse(atob(c.replace(/-/g, "+").replace(/_/g, "/")));
      out.config = mergeConfig(raw);
    } catch {
      /* a broken link just falls back to the seed */
    }
  }
  return out;
}

/** Lays a possibly partial config over the defaults, keeping only numbers. */
function mergeConfig(raw: unknown): SceneConfig {
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const r = (raw ?? {}) as Record<string, Record<string, Record<string, unknown>> & Record<string, unknown>>;
  const d = DEFAULT_CONFIG;
  const objects = { ...d.objects };
  for (const id of OBJECT_IDS) {
    const o = (r.objects?.[id] ?? {}) as Record<string, unknown>;
    objects[id] = { count: num(o.count, d.objects[id].count), size: num(o.size, d.objects[id].size), speed: num(o.speed, d.objects[id].speed) };
  }
  const st = (r.stars ?? {}) as Record<string, unknown>;
  return {
    glyph: num(r.glyph, d.glyph),
    speed: num(r.speed, d.speed),
    bloom: num(r.bloom, d.bloom),
    stars: {
      hero: num(st.hero, d.stars.hero),
      edge: num(st.edge, d.stars.edge),
      edgeWidth: num(st.edgeWidth, d.stars.edgeWidth),
      size: num(st.size, d.stars.size),
      twinkle: num(st.twinkle, d.stars.twinkle),
      tint: num(st.tint, d.stars.tint),
      textBuffer: num(st.textBuffer, d.stars.textBuffer),
    },
    objects,
  };
}

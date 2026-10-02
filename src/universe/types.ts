import type { Grid } from "./engine";

export type RGB = [number, number, number];
export type Stops = [number, RGB][];
export type Rng = () => number;

export const OBJECT_IDS = ["galaxy", "comet", "ship", "planet", "pulsar", "blackhole", "constellation"] as const;
export type ObjectId = (typeof OBJECT_IDS)[number];

export type ObjectCfg = { count: number; size: number; speed: number };

export type StarsCfg = {
  /** Stars per 100k px² across the hero. */
  hero: number;
  /** Stars per 100k px² along the side edges of the page (the hero and everything below it). */
  edge: number;
  /** Width of the edge band, as a fraction of the page width. */
  edgeWidth: number;
  /** Glyph size of the ambient stars, px. */
  size: number;
  /** 0 = steady, 1 = strong twinkle. */
  twinkle: number;
  /** Share of stars that carry a colour tint (ember / sky). */
  tint: number;
  /** How far around the headline the sky stays quiet, px: stars thin out and ships turn away. */
  textBuffer: number;
};

export type SceneConfig = {
  /** Glyph size of the special objects, px. Smaller = finer ASCII. */
  glyph: number;
  /** Global animation speed multiplier. */
  speed: number;
  /** Strength of the soft glow around galaxies, comets, pulsars and black holes (0 = off). */
  bloom: number;
  stars: StarsCfg;
  objects: Record<ObjectId, ObjectCfg>;
};

export type PaletteKey = "ember" | "amber" | "cream" | "sky" | "ice" | "rust" | "deep" | "cyan" | "dust" | "white" | "black";
export type Palette = Record<PaletteKey, RGB>;

/** What the objects need to know about the scene they live in. */
export type SceneView = {
  cfg: SceneConfig;
  seed: number;
  /** Bounds the moving objects roam in (the hero), in page px. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  W: number;
  H: number;
  /** 1 on a desktop screen, smaller on narrow ones: objects and the text buffer shrink with it. */
  scale: number;
  /** The headline's breathing room (plus `pad`), or null when the page has none. Moving objects steer clear of it. */
  zone(pad: number): { x0: number; y0: number; x1: number; y1: number } | null;
};

/** A star as the objects see it while it is being drawn: they may move, brighten or restyle it. */
export type StarOut = { x: number; y: number; boost: number; tint: RGB; ch: string | null };

/* The variation (p) and state (s) bags are deliberately loose: every kind of object keeps different things in them. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Item = {
  def: Def;
  i: number;
  p: any;
  s: any;
  /** Home position, page px. */
  x: number;
  y: number;
  /** 0..1 wake progress and its eased value. */
  a: number;
  k: number;
  awake: boolean;
  /** "Awake clock": seconds spent awake, scaled by speed. */
  ck: number;
  hov: number;
  hovering: boolean;
};

export type Def = {
  id: ObjectId;
  /** How much this kind glows once awake, 0..1 (scaled by the scene's bloom setting). */
  bloom?: number;
  sizeOf(it: Item, sc: SceneView): number;
  /** Stars that belong to this object and live in the starfield (a constellation's vertices). `snap` is how far a scattered star may be absorbed. */
  anchors?(it: Item, sc: SceneView): { x: number; y: number; big: boolean; snap: number }[];
  spawn(rng: Rng, i: number, sc: SceneView): any;
  init(it: Item, sc: SceneView): any;
  update(it: Item, sc: SceneView, dt: number, t: number, k: number): void;
  draw(it: Item, sc: SceneView, g: Grid, t: number, k: number): void;
  hit(it: Item, sc: SceneView, x: number, y: number): boolean;
  starFx?(it: Item, sc: SceneView, star: { x: number; y: number }, out: StarOut, t: number, k: number): void;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

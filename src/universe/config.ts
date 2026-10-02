import type { ObjectId, PaletteKey, SceneConfig } from "./types";

// Starting point for a universe; "randomize" varies every number here from a seed.
export const DEFAULT_CONFIG: SceneConfig = {
  glyph: 4,
  speed: 1,
  bloom: 0.15,
  // edge and textBuffer only matter on a page with a headline and side margins; in a plain rectangle they stay at 0.
  stars: { hero: 20, edge: 0, edgeWidth: 0.2, size: 9, twinkle: 0.4, tint: 0.2, textBuffer: 0 },
  objects: {
    galaxy: { count: 4, size: 92, speed: 1.35 },
    comet: { count: 2, size: 38, speed: 1 },
    ship: { count: 2, size: 50, speed: 0.65 },
    planet: { count: 3, size: 96, speed: 0.7 },
    pulsar: { count: 2, size: 40, speed: 0.9 },
    blackhole: { count: 1, size: 96, speed: 2 },
    constellation: { count: 2, size: 54, speed: 1 },
  },
};

/** Names and notes shown in the control panel. */
export const OBJECT_META: Record<ObjectId, { name: string; note: string; swatches: PaletteKey[] }> = {
  galaxy: {
    name: "Spiral galaxy",
    note: "Four spiral types, each tilted differently, with its own palette and slow spin.",
    swatches: ["cream", "amber", "sky", "cyan", "ice", "ember"],
  },
  comet: {
    name: "Comet",
    note: "Round head and a fan of dashes streaming away. Colour, tail, fan and speed vary.",
    swatches: ["ice", "amber", "sky", "ember", "cyan"],
  },
  ship: {
    name: "Spacecraft",
    note: "Rockets and satellites, each on its own slow trajectory.",
    swatches: ["cream", "rust", "sky", "amber", "ember", "cyan"],
  },
  planet: {
    name: "Ringed planet",
    note: "Size, rings, palette and viewing angle all vary.",
    swatches: ["cream", "amber", "ember", "rust", "sky", "ice"],
  },
  pulsar: {
    name: "Pulsar",
    note: "Six-ray star that beats and sends rings across the sky. Each one is a different colour.",
    swatches: ["ice", "sky", "amber", "cyan", "ember", "cream"],
  },
  blackhole: {
    name: "Black hole",
    note: "On click, nearby stars are yanked in and stay crowded around it.",
    swatches: ["cream", "amber", "ember", "rust"],
  },
  constellation: {
    name: "Constellation",
    note: "Real constellations (Orion, Scorpius, Big Dipper, Cassiopeia, Leo, Cygnus), made by joining actual stars in the starfield.",
    swatches: ["amber", "cream", "ice", "sky"],
  },
};

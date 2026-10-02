import { DEFAULT_CONFIG } from "./universe/config";
import { lerp, mulberry32, pick } from "./universe/engine";
import { OBJECT_IDS } from "./universe/types";
import type { ObjectId, SceneConfig } from "./universe/types";

/** Seeds are six digits, so they fit on the little display and in a link. */
export const MAX_SEED = 999_999;

export const randomSeed = () => Math.floor(Math.random() * (MAX_SEED + 1));
/** Wraps any number into 0..MAX_SEED. */
export const clampSeed = (n: number) => (((Math.floor(n) % (MAX_SEED + 1)) + (MAX_SEED + 1)) % (MAX_SEED + 1));

/** How many of each kind a random universe may hold: [fewest, most]. */
const COUNT: Record<ObjectId, [number, number]> = {
  galaxy: [1, 7],
  comet: [0, 4],
  ship: [0, 4],
  planet: [0, 5],
  pulsar: [0, 5],
  blackhole: [0, 2],
  constellation: [0, 4],
};

/**
 * Every setting of a universe, drawn from a seed. The same seed always gives the same settings,
 * and the scene uses the same seed for where things sit and how each one varies.
 */
export function configFromSeed(seed: number): SceneConfig {
  const rng = mulberry32(seed * 7919 + 17);
  const base = DEFAULT_CONFIG;
  const objects = { ...base.objects };
  let total = 0;
  for (const id of OBJECT_IDS) {
    const [lo, hi] = COUNT[id];
    const count = Math.round(lerp(lo, hi, Math.pow(rng(), 1.2)));
    total += count;
    objects[id] = {
      count,
      size: Math.round(base.objects[id].size * lerp(0.7, 1.25, rng())),
      speed: +(base.objects[id].speed * lerp(0.7, 1.4, rng())).toFixed(2),
    };
  }
  // never an empty sky
  while (total < 5) {
    const id = pick(rng, OBJECT_IDS);
    if (objects[id].count < COUNT[id][1]) {
      objects[id] = { ...objects[id], count: objects[id].count + 1 };
      total++;
    }
  }
  return {
    glyph: pick(rng, [3.5, 4, 4.5, 5]),
    speed: 1,
    bloom: +lerp(0.03, 0.2, rng()).toFixed(2),
    stars: {
      hero: +lerp(8, 40, rng()).toFixed(1),
      edge: 0,
      edgeWidth: base.stars.edgeWidth,
      size: +lerp(7, 12, rng()).toFixed(1),
      twinkle: +lerp(0.15, 0.8, rng()).toFixed(2),
      tint: +lerp(0.05, 0.32, rng()).toFixed(2),
      textBuffer: 0,
    },
    objects,
  };
}

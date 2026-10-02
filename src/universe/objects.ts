/* The seven special objects. Each one has an asleep look (grey, still) and an awake look (colour, motion)
   that it keeps until you generate a new universe or put it back to sleep.
   The variation (p) and state (s) bags are deliberately loose: every kind keeps different things in them. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  TAU, circleCh, clamp, hash, lerp, lineCh, mix, mulberry32, pick, pickCh, ramp, smooth, wrapPi,
} from "./engine";
import type { Grid } from "./engine";
import type { Def, Item, ObjectId, Palette, RGB, SceneView, Stops } from "./types";

const sz = (id: ObjectId, it: Item, sc: SceneView) => sc.cfg.objects[id].size * it.p.sv * sc.scale;
/** Hit target: the object's body, but never smaller than a 44px touch target. */
const hitCircle = (R: number, it: Item, x: number, y: number) => Math.hypot(x - it.x, y - it.y) <= Math.max(R * 0.8, 22);
/** Palettes cycle with the item index (and the shuffle seed) so neighbours never share a colour. */
const cyc = <T,>(arr: readonly T[], i: number, sc: SceneView) => arr[(i + sc.seed - 1) % arr.length];
const noop = () => {};

export function buildObjects(C: Palette): Def[] {
  const dark = (c: RGB, t: number) => mix(C.black, c, t);

  /* 1 · Spiral galaxy ─ four spiral types, each seen from its own angle, with a 3D bulge and a brighter near side */
  const GAL_PALS = {
    sky: { stops: [[0, C.cream], [0.16, C.amber], [0.34, C.sky], [1, mix(C.sky, C.deep, 0.35)]] as Stops, knot: C.ember },
    cyan: { stops: [[0, C.white], [0.2, C.cyan], [0.55, C.cyan], [1, mix(C.cyan, C.sky, 0.5)]] as Stops, knot: C.ice },
    amber: { stops: [[0, C.cream], [0.2, C.amber], [0.5, C.ember], [1, C.rust]] as Stops, knot: C.cream },
    ice: { stops: [[0, C.white], [0.3, C.ice], [1, mix(C.ice, C.sky, 0.45)]] as Stops, knot: C.white },
  };
  type GalPal = keyof typeof GAL_PALS;
  let armV = 0;
  const galaxyDensity = (type: string, r: number, th: number, rot: number, xr: number, yr: number) => {
    let arm = 0;
    let I = 0;
    if (type === "grand") {
      arm = Math.pow(0.5 + 0.5 * Math.cos(2 * (th - 2.9 * Math.log(r + 0.06)) - 2 * rot), 3.2);
      const env = Math.exp(-r * 1.05) * smooth(1.08, 0.82, r);
      I = 0.8 * Math.exp(-(r / 0.2) * (r / 0.2)) + 1.3 * arm * env * smooth(0.05, 0.2, r) + 0.07 * env;
      arm *= env;
    } else if (type === "barred") {
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const bx = xr * c + yr * sn;
      const by = -xr * sn + yr * c;
      const bar = Math.exp(-(by * by) / 0.012) * smooth(0.5, 0.3, Math.abs(bx));
      arm = Math.pow(0.5 + 0.5 * Math.cos(2 * (th - 1.8 * (Math.log(r + 0.12) - Math.log(0.52)) - rot)), 2.4);
      const env = Math.exp(-r * 0.9) * smooth(1.08, 0.8, r) * smooth(0.28, 0.46, r);
      I = 0.7 * Math.exp(-(r / 0.16) * (r / 0.16)) + 0.95 * bar + 1.15 * arm * env;
      arm *= env;
    } else if (type === "rings") {
      const env = smooth(1.08, 0.88, r) * smooth(0.08, 0.2, r);
      arm = Math.pow(0.5 + 0.5 * Math.cos(r * 17 - th + rot * 1.3), 2.2) * env;
      I = 0.55 * Math.exp(-(r / 0.1) * (r / 0.1)) + 0.95 * arm;
    } else {
      const env = Math.exp(-r * 0.85) * smooth(1.08, 0.8, r);
      arm = Math.pow(0.5 + 0.5 * Math.cos(th - 2.4 * Math.log(r + 0.05) - rot), 2.6);
      I = 0.9 * Math.exp(-(r / 0.22) * (r / 0.22)) + 1.2 * arm * env * smooth(0.04, 0.18, r);
      arm *= env;
    }
    armV = arm;
    return I;
  };
  const galaxy: Def = {
    id: "galaxy",
    bloom: 0.7,
    sizeOf: (it, sc) => sz("galaxy", it, sc),
    hit: (it, sc, x, y) => hitCircle(sz("galaxy", it, sc) / 2, it, x, y),
    spawn(rng, i, sc) {
      const TYPES = ["grand", "barred", "rings", "single"];
      const PALS = Object.keys(GAL_PALS);
      const off = sc.seed - 1;
      return {
        type: i < 4 ? TYPES[(i + off) % 4] : pick(rng, TYPES),
        pal: i < 4 ? PALS[(i + off * 3) % 4] : pick(rng, PALS),
        speed: lerp(0.25, 0.5, rng()) * 0.75 * (rng() < 0.5 ? -1 : 1), // 0.25–0.5 of the old (maximum) spin
        tilt: rng() * Math.PI,
        incl: lerp(0.38, 0.92, rng()), // 1 = face-on, 0 = edge-on
        sv: i === 0 ? 1 : lerp(0.8, 1.15, rng()),
      };
    },
    init: () => ({ rot: 0 }),
    update(it, _sc, dt, _t, k) {
      it.s.rot += dt * it.p.speed * k;
    },
    draw(it, sc, g, _t, k) {
      const p = it.p;
      const s = it.s;
      const R = sz("galaxy", it, sc) / 2;
      const ox = it.x;
      const oy = it.y;
      const pal = GAL_PALS[p.pal as GalPal];
      const ct = Math.cos(p.tilt);
      const sn = Math.sin(p.tilt);
      const reveal = k * 1.4;
      const depth = Math.sqrt(1 - p.incl * p.incl);
      g.each(ox - R * 1.2, oy - R * 1.2, ox + R * 1.2, oy + R * 1.2, (px, py, i, j) => {
        const x = (px - ox) / R;
        const y = (py - oy) / R;
        const xr = x * ct + y * sn;
        const ys = -x * sn + y * ct;
        const yr = ys / p.incl;
        const r = Math.hypot(xr, yr);
        let I = 0;
        let arm = 0;
        if (r <= 1.1) {
          I = galaxyDensity(p.type, r, Math.atan2(yr, xr), s.rot, xr, yr);
          arm = armV;
        }
        // 3D: a spherical bulge rising out of the disc, projected toward the far side; the near side is brighter
        const dome = 0.85 * Math.exp(-(xr * xr + (ys + 0.15 * depth) * (ys + 0.15 * depth)) / 0.035);
        I = (I + dome) * (1 + 0.4 * depth * clamp(ys, -1, 1));
        I = Math.min(1, I * lerp(0.62, 1, k));
        if (I < 0.09) return;
        const h1 = hash(i * 1.7, j * 2.3);
        const h2 = hash(i * 3.1, j * 1.3);
        if (I < 0.55 && h1 > smooth(0.06, 0.5, I) * 1.15) return; // stipple the faint parts so the arms read as dotted
        let col = ramp(pal.stops, Math.min(r, 1.1));
        const knot = h1 > 0.93 && arm > 0.15;
        if (knot) col = pal.knot;
        const cAmt = clamp((reveal - r) * 5);
        g.plotCell(i, j, I + (knot ? 0.25 * (0.5 + 0.5 * Math.sin(it.ck * 3 + h1 * 60)) * k : 0), mix(C.dust, col, cAmt), pickCh(I, h2));
      });
    },
  };

  /* 2 · Comet ─ round head, and a fan of dashes streaming away like a blast */
  const COMET_PALS = [
    { head: C.white, tail: mix(C.white, C.ice, 0.35) },
    { head: C.cream, tail: C.amber },
    { head: C.ice, tail: C.sky },
    { head: C.amber, tail: C.ember },
    { head: C.white, tail: C.cyan },
  ];
  const cometScale = (it: Item, sc: SceneView) => sz("comet", it, sc) / 44;
  /** True when a straight flight from (x, y) along `ang` never crosses the headline's breathing room. */
  const pathClear = (sc: SceneView, x: number, y: number, ang: number, pad: number) => {
    const z = sc.zone(pad);
    if (!z) return true;
    const L = Math.max(sc.W, sc.H) * 1.3;
    for (let d = 0; d < L; d += 10) {
      const px = x + Math.cos(ang) * d;
      const py = y + Math.sin(ang) * d;
      if (px > z.x0 && px < z.x1 && py > z.y0 && py < z.y1) return false;
    }
    return true;
  };
  const comet: Def = {
    id: "comet",
    bloom: 1,
    sizeOf: (it, sc) => sz("comet", it, sc),
    spawn(rng, i, sc) {
      return {
        pal: cyc(COMET_PALS, i, sc),
        speed: lerp(7, 16, rng()),
        tail: lerp(26, 54, rng()),
        headR: lerp(6, 9, rng()),
        rays: 9 + ((rng() * 8) | 0),
        fan: lerp(0.38, 0.64, rng()),
        dir: rng() < 0.5 ? 1 : -1,
        a: lerp(0.22, 0.75, rng()),
        seed: rng() * 100,
        seedI: (rng() * 1e9) | 0,
        sv: i === 0 ? 1 : lerp(0.85, 1.2, rng()),
      };
    },
    init(it, sc) {
      const p = it.p;
      const rng = mulberry32(p.seedI);
      const rays: { a: number; len: number; dash: number; gap: number; phase: number; rs: number }[] = [];
      for (let n = 0; n < p.rays; n++) {
        const a = (rng() * 2 - 1) * p.fan;
        const edge = Math.abs(a) / p.fan;
        rays.push({ a, len: (1 - edge * 0.5) * lerp(0.5, 1, rng()), dash: lerp(2, 4.2, rng()), gap: lerp(2, 5, rng()), phase: rng() * 10, rs: lerp(5, 11, rng()) });
      }
      rays.push({ a: 0, len: 1.2, dash: 5, gap: 2.5, phase: 0, rs: 8 }); // the long streak down the axis
      const hr = p.headR * cometScale(it, sc);
      let ang = p.dir > 0 ? p.a : Math.PI - p.a;
      if (!pathClear(sc, it.x, it.y, ang, hr)) {
        search: for (const d of [1, -1]) {
          for (const a of [0.22, 0.35, 0.5, 0.65, 0.75]) {
            const cand = d > 0 ? a : Math.PI - a;
            if (pathClear(sc, it.x, it.y, cand, hr)) {
              ang = cand;
              break search;
            }
          }
        }
      }
      return { mode: "rest", x: it.x, y: it.y, ang, wait: 0, rays };
    },
    update(it, sc, dt, _t, k) {
      const p = it.p;
      const s = it.s;
      const scl = cometScale(it, sc);
      const hr = p.headR * scl;
      const tl = p.tail * scl;
      if (k > 0.02 && s.mode === "rest") s.mode = "fly";
      if (s.mode === "fly") {
        const sp = p.speed * smooth(0, 0.9, k);
        s.x += Math.cos(s.ang) * sp * dt;
        s.y += Math.sin(s.ang) * sp * dt;
        const m = tl * 1.25 + hr + 4;
        if (s.x < sc.x0 - m || s.x > sc.x1 + m || s.y < sc.y0 - m || s.y > sc.y1 + m) {
          s.mode = "wait";
          s.wait = 1.5 + Math.random() * 3;
        }
      } else if (s.mode === "wait") {
        s.wait -= dt;
        if (s.wait <= 0) {
          for (let n = 0; n < 12; n++) {
            const dir = Math.random() < 0.5 ? 1 : -1;
            const a = lerp(0.22, 0.75, Math.random());
            s.ang = dir > 0 ? a : Math.PI - a;
            s.x = dir > 0 ? sc.x0 - (hr + 2) : sc.x1 + hr + 2;
            s.y = sc.y0 - 10 + Math.random() * sc.H * 0.6;
            if (pathClear(sc, s.x, s.y, s.ang, hr)) break; // keep the new flight line off the headline
          }
          s.mode = "fly";
        }
      }
    },
    hit(it, sc, x, y) {
      const s = it.s;
      return s.mode !== "wait" && Math.hypot(x - s.x, y - s.y) <= Math.max(it.p.headR * cometScale(it, sc) + 8, 22);
    },
    draw(it, sc, g, t, k) {
      const p = it.p;
      const s = it.s;
      const scl = cometScale(it, sc);
      const hr = p.headR * scl;
      const tl = p.tail * scl;
      const gain = lerp(0.62, 1, k);
      const c = smooth(0, 0.6, k);
      const tailCol = mix(C.dust, p.pal.tail, c);
      const headCol = mix(C.dust, p.pal.head, c);
      const tdir = s.ang + Math.PI;
      for (const ray of s.rays) {
        // dashes stream outward along each ray (static while asleep)
        const a = tdir + ray.a;
        const rx = Math.cos(a);
        const ry = Math.sin(a);
        const L = tl * ray.len;
        const P = ray.dash + ray.gap;
        const ch = lineCh(rx, ry);
        const off = (((t * ray.rs * k + ray.phase) % P) + P) % P;
        for (let d0 = off - P; d0 < L; d0 += P) {
          const a0 = Math.max(d0, hr * 0.8);
          const a1 = Math.min(d0 + ray.dash, L);
          if (a1 <= a0) continue;
          for (let d = a0; d <= a1; d += 1.2) {
            const f = d / L;
            g.plot(s.x + rx * d, s.y + ry * d, (0.95 - 0.75 * f) * gain, mix(headCol, tailCol, f), ch);
          }
        }
      }
      for (let n = 0; n < 10; n++) {
        // stray dust around the fan
        const a = tdir + (hash(n, p.seed) * 2 - 1) * p.fan * 1.15;
        const d = lerp(hr * 1.2, tl * 0.9, hash(n * 2.1, p.seed + 1));
        const f = d / tl;
        g.plot(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 0.45 * (1 - f) * gain, tailCol, hash(n, p.seed + 2) > 0.5 ? "." : "'");
      }
      // round head: a ring with a small core
      const Rr = hr + 2;
      g.each(s.x - Rr, s.y - Rr, s.x + Rr, s.y + Rr, (px, py, i, j) => {
        const ddx = px - s.x;
        const ddy = py - s.y;
        const d = Math.hypot(ddx, ddy);
        if (d > hr) return;
        const f = d / hr;
        if (f < 0.3) {
          g.put(i, j, gain, headCol, "o");
          return;
        }
        if (f < 0.55) return;
        g.put(i, j, gain, headCol, circleCh(ddx, ddy));
      });
    },
  };

  /* 3 · Spacecraft ─ rockets and satellites, each with its own trajectory and speed */
  const ROCKET_SCHEMES = [
    { body: C.cream, nose: C.rust, fin: C.rust, win: C.sky, flame: [[0, C.cream], [0.25, C.amber], [0.6, C.ember], [1, C.rust]] as Stops },
    { body: C.ice, nose: C.sky, fin: C.deep, win: C.amber, flame: [[0, C.white], [0.25, C.ice], [0.6, C.sky], [1, C.deep]] as Stops },
    { body: C.amber, nose: C.ember, fin: C.rust, win: C.ice, flame: [[0, C.cream], [0.25, C.amber], [0.6, C.ember], [1, C.rust]] as Stops },
  ];
  const SAT_SCHEMES = [
    { body: C.cream, panel: C.sky, panel2: C.deep, dish: C.amber },
    { body: C.ice, panel: C.amber, panel2: C.ember, dish: C.cream },
    { body: C.amber, panel: C.cyan, panel2: C.deep, dish: C.ice },
  ];
  const shipSize = (it: Item, sc: SceneView) => sz("ship", it, sc) * (it.p.kind === "rocket" ? 1 : 1.25); // satellites run larger so they read

  const drawRocket = (it: Item, sc: SceneView, g: Grid, k: number) => {
    const p = it.p;
    const s = it.s;
    const sch = p.sch;
    const R = shipSize(it, sc) / 2;
    for (const q of s.sm) {
      const a = q.age;
      g.plot(q.x, q.y, 0.5 * Math.pow(1 - a, 1.3), mix(C.rust, dark(C.dust, 0.55), a), a < 0.5 ? ":" : ".");
    }
    for (const q of s.fl) g.plot(q.x, q.y, Math.pow(1 - q.age, 0.9), ramp(sch.flame, q.age));
    const c = Math.cos(s.h);
    const sn = Math.sin(s.h);
    g.each(s.x - R * 1.1, s.y - R * 1.1, s.x + R * 1.1, s.y + R * 1.1, (px, py, i, j) => {
      const dx = px - s.x;
      const dy = py - s.y;
      const u = (dx * c + dy * sn) / R;
      const v = (-dx * sn + dy * c) / R;
      const av = Math.abs(v);
      let part = 0;
      let I = 0;
      let hw = 0;
      if (u >= -0.6 && u <= 0.35) hw = 0.2;
      else if (u > 0.35 && u <= 0.8) {
        const q = (u - 0.35) / 0.45;
        hw = 0.2 * Math.sqrt(1 - q * q);
      }
      if (hw > 0 && av <= hw) {
        part = u > 0.5 ? 2 : 1;
        I = part === 2 ? 0.88 : 0.5 + 0.25 * (1 - av / hw);
      }
      if (u >= -0.82 && u <= -0.2) {
        const lim = 0.2 + 0.26 * ((-0.2 - u) / 0.62);
        if (av <= lim && av >= 0.14) {
          part = 4;
          I = 0.95;
        }
      }
      if (u < -0.6 && u >= -0.72 && av < 0.1) {
        part = 5;
        I = 0.5;
      }
      if (Math.hypot(u - 0.12, v) < 0.1) {
        part = 3;
        I = 1;
      }
      if (!part) return;
      const col = [C.black, sch.body, sch.nose, sch.win, sch.fin, dark(C.dust, 0.7)][part];
      g.put(i, j, I * lerp(0.7, 1, k), mix(C.dust, col, k));
    });
  };

  const drawSat = (it: Item, sc: SceneView, g: Grid, t: number, k: number) => {
    const p = it.p;
    const s = it.s;
    const sch = p.sch;
    const R = shipSize(it, sc) / 2;
    const gk = lerp(0.7, 1, k);
    const band = g.chh * 0.85;
    const c = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    const hot = (col: RGB) => mix(col, C.white, 0.4);
    const rect = (u: number, v: number, cu: number, hu: number, cv: number, hv: number) => {
      const du = hu - Math.abs(u - cu);
      const dv = hv - Math.abs(v - cv);
      return du < 0 || dv < 0 ? -1 : Math.min(du, dv) * R;
    };
    g.each(s.x - R * 1.15, s.y - R * 1.15, s.x + R * 1.15, s.y + R * 1.15, (px, py, i, j) => {
      const dx = px - s.x;
      const dy = py - s.y;
      const u = (dx * c + dy * sn) / R;
      const v = (-dx * sn + dy * c) / R;
      let col: RGB | null = null;
      let I = 0;
      let ch: string | undefined;
      let edge = false;
      let d: number;
      for (const side of [-1, 1]) {
        // solar wings, outlined, with alternating cells inside
        d = rect(u, v, side * 0.66, 0.4, 0, 0.17);
        if (d >= 0) {
          edge = d < band;
          const cell = Math.floor((Math.abs(u) - 0.26) / 0.13) % 2;
          col = cell ? sch.panel2 : sch.panel;
          I = edge ? 1 : cell ? 0.5 : 0.75;
          ch = edge ? "#" : cell ? "=" : "+";
        }
      }
      if (Math.abs(v) < 0.035 && Math.abs(u) >= 0.2 && Math.abs(u) < 0.27) {
        col = sch.body;
        I = 0.7;
        edge = false;
        ch = "-";
      }
      d = rect(u, v, 0, 0.22, 0, 0.22);
      if (d >= 0) {
        edge = d < band;
        col = sch.body;
        I = edge ? 1 : 0.5;
        ch = edge ? "@" : ":";
      }
      if (v < -0.24 && v > -0.55) {
        // dish
        const hw = 0.06 + (-0.24 - v) * 0.45;
        if (Math.abs(u) < hw) {
          edge = Math.min((hw - Math.abs(u)) * R, (v + 0.55) * R) < band;
          col = sch.dish;
          I = edge ? 1 : 0.6;
          ch = edge ? "#" : ":";
        }
      }
      if (Math.abs(u) < 0.03 && v <= -0.55 && v > -0.68) {
        col = sch.dish;
        I = 0.8;
        edge = false;
        ch = "|";
      }
      if (col) g.put(i, j, I * gk, mix(C.dust, edge ? hot(col) : col, k), ch);
    });
    const on = (t * 1.3 + p.rot0) % 2 < 0.8;
    const lu = 0.12;
    const lv = 0.12;
    g.putXY(s.x + (lu * c - lv * sn) * R, s.y + (lu * sn + lv * c) * R, k > 0.3 && on ? 1 : 0.45, k > 0.3 && on ? C.ember : C.dust, "o");
  };

  const ship: Def = {
    id: "ship",
    bloom: 0.7,
    sizeOf: shipSize,
    spawn(rng, i, sc) {
      const kind = i % 2 === 0 ? "rocket" : "satellite"; // alternate, so any count is a mix
      const trajs = { rocket: ["curve", "straight", "orbit"], satellite: ["straight", "orbit"] }[kind];
      const traj = i === 0 ? "curve" : pick(rng, trajs);
      const list: readonly unknown[] = kind === "rocket" ? ROCKET_SCHEMES : SAT_SCHEMES;
      const sch = i < 6 ? cyc(list, i >> 1, sc) : pick(rng, list); // neighbours of the same kind get different colours
      return {
        kind,
        traj,
        sch,
        speed: kind === "rocket" ? lerp(4.5, 8.5, rng()) : lerp(3.5, 7, rng()), // 0.25–0.5 of the old speed
        h0: i === 0 ? -0.55 : (rng() < 0.5 ? 0 : Math.PI) + lerp(-0.6, 0.6, rng()),
        orbR: lerp(16, 30, rng()),
        ecc: lerp(0.55, 1, rng()),
        dir: rng() < 0.5 ? 1 : -1,
        th0: rng() * TAU,
        spin: lerp(0.12, 0.25, rng()) * (rng() < 0.5 ? 1 : -1),
        rot0: rng() * TAU,
        sv: i === 0 ? 1 : lerp(0.85, 1.15, rng()),
      };
    },
    init(it) {
      const p = it.p;
      const s: any = { ax: it.x, ay: it.y, x: it.x, y: it.y, h: p.h0, h0: p.h0, dir: p.dir, th: p.th0, cx: 0, cy: 0, rot: p.rot0, fl: [], sm: [], accF: 0, accS: 0 };
      if (p.traj === "orbit") {
        s.cx = it.x - p.orbR * Math.cos(p.th0);
        s.cy = it.y - p.orbR * p.ecc * Math.sin(p.th0);
        s.h = Math.atan2(p.ecc * Math.cos(p.th0) * p.dir, -Math.sin(p.th0) * p.dir);
      }
      return s;
    },
    update(it, sc, dt, _t, k) {
      const p = it.p;
      const s = it.s;
      const R = shipSize(it, sc) / 2;
      const kk = smooth(0, 1, k);
      const sp = p.speed * kk;
      const ck = it.ck;
      const zone = sc.zone(R * 0.6 + 8);
      const { ax: pax, ay: pay, th: pth, x: ppx, y: ppy } = s; // where it was, in case it has to turn back
      let x: number;
      let y: number;
      let h = s.h;
      if (p.traj === "curve" || p.traj === "straight") {
        h = p.traj === "curve" ? s.h0 + 0.6 * Math.sin(ck * 0.42) : s.h0;
        s.ax += Math.cos(h) * sp * dt;
        s.ay += Math.sin(h) * sp * dt;
        x = s.ax;
        y = s.ay;
      } else {
        // orbit
        s.th += s.dir * (sp / p.orbR) * dt;
        x = s.cx + p.orbR * Math.cos(s.th);
        y = s.cy + p.orbR * p.ecc * Math.sin(s.th);
        h = Math.atan2(p.ecc * Math.cos(s.th) * s.dir, -Math.sin(s.th) * s.dir);
      }
      const insideZone = (px: number, py: number) => !!zone && px > zone.x0 && px < zone.x1 && py > zone.y0 && py < zone.y1;
      if (insideZone(x, y) && !insideZone(ppx, ppy)) {
        // about to drift behind the headline: bounce off its breathing room instead
        if (p.traj === "orbit") {
          s.dir = -s.dir;
          s.th = pth;
        } else {
          s.h0 = ppx <= zone!.x0 || ppx >= zone!.x1 ? Math.PI - s.h0 : -s.h0;
          s.ax = pax;
          s.ay = pay;
        }
        x = ppx;
        y = ppy;
        h = s.h;
      }
      const m = R + 8;
      let shx = 0;
      let shy = 0;
      if (x < sc.x0 - m) shx = sc.W + 2 * m;
      else if (x > sc.x1 + m) shx = -(sc.W + 2 * m);
      if (y < sc.y0 - m) shy = sc.H + 2 * m;
      else if (y > sc.y1 + m) shy = -(sc.H + 2 * m);
      if (shx || shy) {
        s.ax += shx;
        s.ay += shy;
        s.cx += shx;
        s.cy += shy;
        x += shx;
        y += shy;
      }
      s.x = x;
      s.y = y;
      s.h = h;
      if (p.kind === "satellite") s.rot += p.spin * dt * kk;
      if (p.kind === "rocket") {
        const dx = Math.cos(h);
        const dy = Math.sin(h);
        const tx = x - dx * R * 0.78;
        const ty = y - dy * R * 0.78;
        s.accF += dt * 110 * smooth(0.1, 0.7, k);
        s.accS += dt * 18 * smooth(0.1, 0.7, k);
        while (s.accF >= 1) {
          s.accF--;
          s.fl.push({ x: tx, y: ty, vx: -dx * 38 + (Math.random() - 0.5) * 10, vy: -dy * 38 + (Math.random() - 0.5) * 10, age: 0, life: 0.35 + Math.random() * 0.3 });
        }
        while (s.accS >= 1) {
          s.accS--;
          s.sm.push({ x: tx, y: ty, vx: -dx * 4 + (Math.random() - 0.5) * 3, vy: -dy * 4 + (Math.random() - 0.5) * 3, age: 0, life: 2.8 });
        }
      }
      for (const arr of [s.fl, s.sm]) {
        for (let i = arr.length - 1; i >= 0; i--) {
          const q = arr[i];
          q.age += dt / q.life;
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          if (q.age >= 1) arr.splice(i, 1);
        }
      }
    },
    hit: (it, sc, x, y) => Math.hypot(x - it.s.x, y - it.s.y) <= Math.max(shipSize(it, sc) * 0.45, 22),
    draw(it, sc, g, t, k) {
      if (it.p.kind === "rocket") drawRocket(it, sc, g, k);
      else drawSat(it, sc, g, t, k);
    },
  };

  /* 4 · Ringed planet ─ varied size, rings and viewing angle; bands follow the planet's curvature */
  const PLANET_PALS = [
    { body: [[0, dark(C.rust, 0.5)], [0.35, C.rust], [0.62, C.ember], [0.88, C.amber], [1, C.cream]] as Stops, ring: [[0, C.cream], [1, C.amber]] as Stops },
    { body: [[0, dark(C.deep, 0.45)], [0.35, C.deep], [0.62, C.sky], [0.88, C.ice], [1, C.white]] as Stops, ring: [[0, C.ice], [1, C.sky]] as Stops },
    { body: [[0, dark(C.amber, 0.3)], [0.35, mix(C.rust, C.amber, 0.5)], [0.62, C.amber], [0.88, C.cream], [1, C.white]] as Stops, ring: [[0, C.cream], [1, C.ember]] as Stops },
  ];
  const planet: Def = {
    id: "planet",
    bloom: 0.6,
    sizeOf: (it, sc) => sz("planet", it, sc),
    hit: (it, sc, x, y) => hitCircle(sz("planet", it, sc) / 2, it, x, y),
    spawn(rng, i, sc) {
      let S: number;
      let rings: [number, number][];
      if (i === 0) {
        S = 0.58;
        rings = [[0.84, 1.02], [1.12, 1.28]];
      } else {
        S = lerp(0.38, 0.62, rng());
        const n = pick(rng, [1, 1, 2, 3]);
        const w = lerp(0.07, 0.15, rng());
        const gap = lerp(0.035, 0.08, rng());
        let a = S * lerp(1.3, 1.55, rng());
        rings = [];
        for (let r = 0; r < n; r++) {
          const b = a + w * (r === 0 ? 1 : lerp(0.6, 1.1, rng()));
          rings.push([a, b]);
          a = b + gap;
        }
        const last = rings[n - 1][1];
        if (last > 1.3) {
          const f = 1.3 / last;
          rings.forEach((q) => {
            q[0] *= f;
            q[1] *= f;
          });
        }
        S = Math.min(S, rings[0][0] / 1.2);
      }
      return {
        S,
        rings,
        q0: rings[0][0],
        q1: rings[rings.length - 1][1],
        pal: cyc(PLANET_PALS, i, sc),
        tilt: i === 0 ? -0.34 : (rng() * 2 - 1) * 1.1,
        ratio: i === 0 ? 0.34 : lerp(0.14, 0.55, rng()),
        lightA: i === 0 ? -2.3 : rng() * TAU,
        bf: lerp(5, 8, rng()),
        storm: i === 0 || rng() < 0.6,
        lon0: rng() * TAU,
        lat0: lerp(0.15, 0.45, rng()) * (rng() < 0.5 ? -1 : 1),
        ph: rng() * TAU,
        sv: i === 0 ? 1 : lerp(0.75, 1.2, rng()),
      };
    },
    init: () => ({}),
    update: noop,
    draw(it, sc, g, _t, k) {
      const p = it.p;
      const R = sz("planet", it, sc) / 2;
      const ox = it.x;
      const oy = it.y;
      const ck = it.ck;
      const S = p.S;
      const ratio = p.ratio;
      const sinB = ratio;
      const cosB = Math.sqrt(1 - ratio * ratio); // how far the pole leans toward the viewer
      const tilt = p.tilt + 0.09 * Math.sin(ck * 0.55 + p.ph) * k;
      const ct = Math.cos(tilt);
      const sn = Math.sin(tilt);
      const la = p.lightA + 0.5 * Math.sin(ck * 0.3 + p.ph) * k;
      let L = [Math.cos(la) * 0.55, Math.sin(la) * 0.45 - 0.1, 0.8];
      const ln = Math.hypot(...L);
      L = L.map((v) => v / ln);
      g.each(ox - R * 1.6, oy - R * 1.6, ox + R * 1.6, oy + R * 1.6, (px, py, i, j) => {
        const x = (px - ox) / R;
        const y = (py - oy) / R;
        const rho = Math.hypot(x, y);
        const xr = x * ct + y * sn;
        const yr = -x * sn + y * ct;
        const q = Math.hypot(xr, yr / ratio);
        const inSph = rho < S;
        if (inSph) {
          const nx = x / S;
          const ny = y / S;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
          const nxr = xr / S;
          const nyr = yr / S;
          const lat = -nyr * cosB + nz * sinB; // latitude lines curve with the tilt
          const band = 0.5 + 0.5 * Math.sin(lat * p.bf * 1.2 + Math.sin(nxr * 2.4 + lat * 1.5 + ck * 0.5) * 0.7);
          let I = (0.3 + 0.7 * d) * (0.5 + 0.5 * band);
          let col = ramp(p.pal.body, I);
          if (p.storm) {
            const dl = wrapPi(Math.asin(clamp(nxr, -1, 1)) - ck * 0.5 - p.lon0);
            const storm = Math.exp(-(dl * dl) / 0.12 - ((lat - p.lat0) * (lat - p.lat0)) / 0.03);
            col = mix(col, C.rust, storm * 0.8 * k);
            I = Math.min(1, I + storm * 0.15 * k);
          }
          g.put(i, j, lerp(0.18 + 0.3 * d, I, k), mix(C.dust, col, k));
        }
        if (q >= p.q0 && q <= p.q1 && (yr > 0 || !inSph)) {
          let idx = -1;
          for (let n = 0; n < p.rings.length; n++) {
            if (q >= p.rings[n][0] && q <= p.rings[n][1]) {
              idx = n;
              break;
            }
          }
          if (idx < 0) return;
          const I = 0.42 + 0.16 * Math.sin(q * 55 + idx * 1.7);
          const col = ramp(p.pal.ring, (q - p.q0) / Math.max(0.01, p.q1 - p.q0));
          g.put(i, j, lerp(0.42, I, k), mix(C.dust, col, k));
        }
      });
    },
  };

  /* 5 · Pulsar ─ a larger resting glint so it can be found; a slow, varied beat */
  const PULSAR_PALS = [
    { spike: [[0, C.white], [0.35, C.ice], [1, C.sky]] as Stops, ring: [[0, C.ice], [0.5, C.sky], [1, C.deep]] as Stops, tint: C.ice },
    { spike: [[0, C.cream], [0.4, C.amber], [1, C.ember]] as Stops, ring: [[0, C.amber], [0.5, C.ember], [1, C.rust]] as Stops, tint: C.amber },
    { spike: [[0, C.white], [0.35, C.cyan], [1, C.sky]] as Stops, ring: [[0, C.cyan], [0.5, C.sky], [1, C.deep]] as Stops, tint: C.cyan },
    { spike: [[0, C.cream], [0.4, C.ember], [1, C.rust]] as Stops, ring: [[0, C.ember], [0.5, C.rust], [1, dark(C.rust, 0.5)]] as Stops, tint: C.ember },
    { spike: [[0, C.white], [0.5, C.cream], [1, C.amber]] as Stops, ring: [[0, C.cream], [0.5, C.amber], [1, C.ember]] as Stops, tint: C.cream },
  ];
  const pulsarPeriod = (p: any) => 1.55 / p.m;
  const ringFade = (p: any, r: number) => Math.pow(Math.max(0, 1 - r / p.ringMax), 1.3) * 0.85;
  const pulsar: Def = {
    id: "pulsar",
    bloom: 0.7,
    sizeOf: (it, sc) => sz("pulsar", it, sc),
    hit: (it, sc, x, y) => hitCircle(sz("pulsar", it, sc) / 2, it, x, y),
    spawn(rng, i, sc) {
      return {
        pal: cyc(PULSAR_PALS, i, sc),
        m: i === 0 ? 0.5 : lerp(0.25, 0.75, rng()), // beat speed: 0.25–0.75 of the old
        spike: i === 0 ? 1 : lerp(0.8, 1.4, rng()),
        ringMax: i === 0 ? 120 : lerp(70, 150, rng()),
        ph: rng() * TAU,
        sv: i === 0 ? 1 : lerp(0.85, 1.2, rng()),
      };
    },
    init: () => ({ rings: [], last: -1 }),
    update(it, _sc, dt, _t, k) {
      const p = it.p;
      const s = it.s;
      const idx = Math.floor(it.ck / pulsarPeriod(p));
      if (k > 0.05 && idx !== s.last) {
        s.last = idx;
        s.rings.push({ r: 3 });
      }
      for (let i = s.rings.length - 1; i >= 0; i--) {
        s.rings[i].r += dt * 52 * p.m;
        if (s.rings[i].r > p.ringMax) s.rings.splice(i, 1);
      }
    },
    starFx(it, _sc, _star, out, _t, k) {
      const d = Math.hypot(out.x - it.x, out.y - it.y);
      for (const ring of it.s.rings) {
        const dd = (d - ring.r) / 7;
        out.boost += Math.exp(-dd * dd) * ringFade(it.p, ring.r) * 1.3 * k;
      }
      out.tint = it.p.pal.tint;
    },
    draw(it, sc, g, t, k) {
      const p = it.p;
      const s = it.s;
      const R = sz("pulsar", it, sc) / 2;
      const ox = it.x;
      const oy = it.y;
      const ck = it.ck;
      const T = pulsarPeriod(p);
      const pulse = Math.exp(-((ck % T) / T) * 4.2) * k;
      const wRay = g.cw * 0.78;
      const rays = (angles: number[], L: number, I0: number, colFn: (f: number) => RGB, w: number) => {
        g.each(ox - L - 3, oy - L - 3, ox + L + 3, oy + L + 3, (px, py, i, j) => {
          const x = px - ox;
          const y = py - oy;
          for (const a of angles) {
            const cx = Math.cos(a);
            const cy = Math.sin(a);
            const sAlong = x * cx + y * cy;
            const perp = Math.abs(-x * cy + y * cx);
            if (perp < w && Math.abs(sAlong) < L) {
              const I = I0 * Math.pow(1 - Math.abs(sAlong) / L, 1.1);
              g.plotCell(i, j, I, colFn(Math.abs(sAlong) / L), lineCh(cx, cy));
            }
          }
        });
      };
      if (k < 0.99) {
        // resting: a larger four-ray glint with a dotted halo
        const tw = 0.85 + 0.15 * Math.sin(t * 1.6 + p.ph);
        const white = mix(C.dust, C.white, 0.7);
        const a = 1 - k;
        rays([0, Math.PI / 2], R * 0.62, 0.95 * a * tw, (f) => mix(white, C.dust, f * 0.6), g.cw * 0.6);
        const n = 16;
        for (let m = 0; m < n; m++) {
          const an = (m / n) * TAU;
          g.plot(ox + Math.cos(an) * R * 0.5, oy + Math.sin(an) * R * 0.5, 0.42 * a * tw, C.dust, ".");
        }
        g.plot(ox, oy, a * tw, white, "+");
      }
      if (k > 0.01) {
        // awake: six rays, spinning slowly, breathing with the beat
        const a0 = ck * 0.32 * p.m * 2;
        const L = R * (0.6 + 0.55 * pulse) * lerp(0.8, 1, k) * p.spike;
        rays([a0, a0 + Math.PI / 3, a0 + (2 * Math.PI) / 3], L, 0.95 * k, (f) => ramp(p.pal.spike, f), wRay);
        const cI = (0.8 + 0.2 * pulse) * k;
        const cr = 5.2 * Math.sqrt(p.spike);
        g.each(ox - cr, oy - cr, ox + cr, oy + cr, (px, py, i, j) => {
          const d = Math.hypot(px - ox, py - oy);
          if (d < cr) g.plotCell(i, j, cI * (1 - d / (cr + 1)), C.white, d < cr * 0.58 ? "@" : "*");
        });
      }
      for (const ring of s.rings) {
        const r = ring.r;
        const fade = ringFade(p, r) * k;
        g.each(ox - r - 4, oy - r - 4, ox + r + 4, oy + r + 4, (px, py, i, j) => {
          const dd = Math.abs(Math.hypot(px - ox, py - oy) - r);
          if (dd > 2.3) return;
          const I = (1 - dd / 2.3) * fade;
          if (I < 0.07) return;
          g.plotCell(i, j, I, ramp(p.pal.ring, r / p.ringMax), I > 0.5 ? "o" : ".");
        });
      }
    },
  };

  /* 6 · Black hole ─ varied viewing angle; on click nearby stars are pulled in fast (a quick whoop) and stay crowded around it */
  const blackhole: Def = {
    id: "blackhole",
    bloom: 0.9,
    sizeOf: (it, sc) => sz("blackhole", it, sc),
    hit: (it, sc, x, y) => hitCircle(sz("blackhole", it, sc) / 2, it, x, y),
    spawn: (rng, i) => ({
      tilt: i === 0 ? -0.2 : (rng() * 2 - 1) * 1.2,
      ratio: i === 0 ? 0.32 : lerp(0.14, 0.5, rng()),
      sv: i === 0 ? 1 : lerp(0.85, 1.15, rng()),
    }),
    init: () => ({ pull: 0 }),
    update(it, _sc, dt) {
      if (it.awake) it.s.pull = Math.min(1, it.s.pull + dt / 0.6);
    },
    starFx(it, sc, _star, out) {
      const s = it.s;
      if (s.pull <= 0) return;
      const dx = out.x - it.x;
      const dy = out.y - it.y;
      const d = Math.hypot(dx, dy);
      const R = sz("blackhole", it, sc) / 2;
      const Rp = R * 3.6;
      if (d < 1 || d >= Rp) return;
      const e = 1 - Math.pow(1 - s.pull, 3); // fast start, soft landing
      const u = d / Rp;
      const d2 = lerp(d, R * 0.3 + (Rp * 0.4 - R * 0.3) * Math.pow(u, 1.5), e);
      const th = Math.atan2(dy, dx) + e * 0.9 * Math.exp(-d / (Rp * 0.6)) + it.ck * 0.35 * Math.exp(-d / (Rp * 0.5));
      out.x = it.x + Math.cos(th) * d2;
      out.y = it.y + Math.sin(th) * d2;
      out.boost += e * Math.exp(-d / (Rp * 0.4)) * 0.9;
      out.tint = C.amber;
      if (s.pull < 0.75) out.ch = lineCh(dx, dy); // streaks while they fall
    },
    draw(it, sc, g, _t, k) {
      const p = it.p;
      const R = sz("blackhole", it, sc) / 2;
      const ox = it.x;
      const oy = it.y;
      const ck = it.ck;
      const ct = Math.cos(p.tilt);
      const sn = Math.sin(p.tilt);
      const ratio = p.ratio;
      const H = 0.2;
      const diskCol: Stops = [[0.3, C.cream], [0.42, C.amber], [0.7, C.ember], [1.05, C.rust]];
      g.each(ox - R * 1.25, oy - R * 1.25, ox + R * 1.25, oy + R * 1.25, (px, py, i, j) => {
        const x = (px - ox) / R;
        const y = (py - oy) / R;
        const rho = Math.hypot(x, y);
        const xr = x * ct + y * sn;
        const yy = -x * sn + y * ct;
        const front = yy > 0;
        const q = Math.hypot(xr, yy / ratio);
        let diskI = 0;
        if (q > 0.3 && q < 1.05) {
          const bin = Math.floor(q * 9);
          const ph = ck * 0.85 * Math.pow(0.42 / (bin / 9 + 0.12), 1.5);
          const ang = Math.atan2(yy / ratio, xr);
          const sw = 0.5 + 0.5 * Math.sin(3 * (ang - ph) + bin * 1.7);
          diskI = Math.exp(-(q - 0.3) * 1.5) * (0.35 + 0.65 * sw) * (0.78 + 0.35 * xr) * smooth(1.05, 0.85, q) * smooth(0.3, 0.36, q);
        }
        diskI *= lerp(0.55, 1, k);
        let arcI = 0;
        if (rho > H && rho < 0.5) {
          // light bent over the far side of the disk, in the disk's own frame
          const rr = (rho - 0.28) / 0.075;
          arcI = Math.exp(-rr * rr) * (0.35 + 0.65 * smooth(-0.25, 0.9, -yy / rho)) * (0.8 + 0.2 * Math.sin(ck * 1.3 + Math.atan2(yy, xr) * 2));
        }
        const ring = rho >= H && rho < H + 0.1 ? 0.95 : 0;
        if (rho < H) {
          // the void: only the near side of the disk crosses in front of it
          if (!(front && diskI > 0.05)) {
            g.erase(i, j);
            return;
          }
        }
        let I = Math.max(diskI, arcI, ring);
        if (I < 0.07) return;
        const col = diskI >= arcI && diskI >= ring ? ramp(diskCol, q) : mix(C.cream, C.amber, clamp((rho - H) / 0.3));
        I = Math.min(1, I * lerp(0.62, 1, k));
        const out = mix(C.dust, col, smooth(0, 0.8, k));
        if (rho < H) g.put(i, j, I, out);
        else g.plotCell(i, j, I, out);
      });
    },
  };

  /* 7 · Constellation ─ real constellations: dotted connectors at rest; every line and star lights up at once and twinkles */
  type RawConstellation = {
    name: string;
    /** [name, right ascension (hours), declination (degrees)] */
    stars: [string, number, number][];
    edges: [string, string][];
    big: string[];
  };
  const RAW: RawConstellation[] = [
    {
      name: "Orion",
      stars: [["Meissa", 5.585, 9.93], ["Betelgeuse", 5.919, 7.41], ["Bellatrix", 5.419, 6.35], ["Alnitak", 5.679, -1.94], ["Alnilam", 5.603, -1.2], ["Mintaka", 5.533, -0.3], ["Saiph", 5.796, -9.67], ["Rigel", 5.242, -8.2], ["Hatysa", 5.59, -5.91]],
      edges: [["Meissa", "Betelgeuse"], ["Meissa", "Bellatrix"], ["Betelgeuse", "Alnitak"], ["Bellatrix", "Mintaka"], ["Alnitak", "Alnilam"], ["Alnilam", "Mintaka"], ["Alnitak", "Saiph"], ["Mintaka", "Rigel"], ["Alnilam", "Hatysa"]],
      big: ["Betelgeuse", "Rigel"],
    },
    {
      name: "Scorpius",
      stars: [["Graffias", 16.09, -19.81], ["Dschubba", 16.005, -22.62], ["Pi", 15.98, -26.11], ["Sigma", 16.353, -25.59], ["Antares", 16.49, -26.43], ["Tau", 16.598, -28.22], ["Epsilon", 16.836, -34.29], ["Mu", 16.865, -38.05], ["Zeta", 16.91, -42.36], ["Eta", 17.203, -43.24], ["Sargas", 17.622, -42.99], ["Iota", 17.793, -40.13], ["Kappa", 17.708, -39.03], ["Shaula", 17.56, -37.1]],
      edges: [["Graffias", "Dschubba"], ["Dschubba", "Pi"], ["Dschubba", "Sigma"], ["Sigma", "Antares"], ["Antares", "Tau"], ["Tau", "Epsilon"], ["Epsilon", "Mu"], ["Mu", "Zeta"], ["Zeta", "Eta"], ["Eta", "Sargas"], ["Sargas", "Iota"], ["Iota", "Kappa"], ["Kappa", "Shaula"]],
      big: ["Antares"],
    },
    {
      name: "Big Dipper",
      stars: [["Dubhe", 11.062, 61.75], ["Merak", 11.031, 56.38], ["Phecda", 11.897, 53.69], ["Megrez", 12.257, 57.03], ["Alioth", 12.9, 55.96], ["Mizar", 13.399, 54.93], ["Alkaid", 13.792, 49.31]],
      edges: [["Dubhe", "Merak"], ["Merak", "Phecda"], ["Phecda", "Megrez"], ["Megrez", "Dubhe"], ["Megrez", "Alioth"], ["Alioth", "Mizar"], ["Mizar", "Alkaid"]],
      big: [],
    },
    {
      name: "Cassiopeia",
      stars: [["Caph", 0.153, 59.15], ["Schedar", 0.675, 56.54], ["Navi", 0.945, 60.72], ["Ruchbah", 1.43, 60.24], ["Segin", 1.907, 63.67]],
      edges: [["Caph", "Schedar"], ["Schedar", "Navi"], ["Navi", "Ruchbah"], ["Ruchbah", "Segin"]],
      big: [],
    },
    {
      name: "Leo",
      stars: [["Regulus", 10.139, 11.97], ["Eta", 10.122, 16.76], ["Algieba", 10.333, 19.84], ["Adhafera", 10.278, 23.42], ["Rasalas", 9.879, 26.01], ["Algenubi", 9.764, 23.77], ["Zosma", 11.235, 20.52], ["Chertan", 11.237, 15.43], ["Denebola", 11.818, 14.57]],
      edges: [["Regulus", "Eta"], ["Eta", "Algieba"], ["Algieba", "Adhafera"], ["Adhafera", "Rasalas"], ["Rasalas", "Algenubi"], ["Algieba", "Zosma"], ["Zosma", "Denebola"], ["Denebola", "Chertan"], ["Chertan", "Zosma"], ["Regulus", "Chertan"]],
      big: ["Regulus"],
    },
    {
      name: "Cygnus",
      stars: [["Deneb", 20.69, 45.28], ["Sadr", 20.37, 40.26], ["Albireo", 19.512, 27.96], ["Gienah", 20.77, 33.97], ["Delta", 19.75, 45.13]],
      edges: [["Deneb", "Sadr"], ["Sadr", "Albireo"], ["Delta", "Sadr"], ["Sadr", "Gienah"]],
      big: ["Deneb"],
    },
  ];
  // Project the sky onto the page: east is left, north is up, RA stretched by cos(dec); centred and scaled to ±1.
  const SHAPES = RAW.map((c) => {
    const ra0 = c.stars.reduce((a, s) => a + s[1] * 15, 0) / c.stars.length;
    const dec0 = c.stars.reduce((a, s) => a + s[2], 0) / c.stars.length;
    const cosD = Math.cos((dec0 * Math.PI) / 180);
    const pts = c.stars.map((s) => [-(s[1] * 15 - ra0) * cosD, -(s[2] - dec0)] as [number, number]);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const m = Math.max(...pts.map((q) => Math.max(Math.abs(q[0] - cx), Math.abs(q[1] - cy))));
    const index = (name: string) => c.stars.findIndex((s) => s[0] === name);
    return {
      name: c.name,
      pts: pts.map((q) => [(q[0] - cx) / m, (q[1] - cy) / m] as [number, number]),
      edges: c.edges.map(([a, b]) => [index(a), index(b)] as [number, number]),
      big: c.big.map(index),
    };
  });
  const CON_PALS = [{ line: C.amber, star: C.ice }, { line: C.ice, star: C.white }, { line: C.cream, star: C.amber }, { line: C.sky, star: C.ice }];
  /** The page positions of a constellation's stars. */
  const constellationPoints = (it: Item, sc: SceneView): [number, number][] => {
    const p = it.p;
    const R = (sz("constellation", it, sc) / 2) * 0.95;
    const c = Math.cos(p.rot);
    const sn = Math.sin(p.rot);
    return p.shape.pts.map(([u, v]: [number, number]) => [it.x + (u * c - v * sn) * R, it.y + (u * sn + v * c) * R]);
  };
  const constellation: Def = {
    id: "constellation",
    bloom: 0.9,
    sizeOf: (it, sc) => sz("constellation", it, sc),
    hit: (it, sc, x, y) => Math.hypot(x - it.x, y - it.y) <= Math.max(sz("constellation", it, sc) * 0.55, 22),
    spawn: (rng, i, sc) => ({
      shape: i < SHAPES.length ? SHAPES[(i + sc.seed - 1) % SHAPES.length] : pick(rng, SHAPES),
      rot: lerp(-0.25, 0.25, rng()),
      pal: cyc(CON_PALS, i, sc),
      ph: rng() * TAU,
      sv: i === 0 ? 1 : lerp(0.9, 1.12, rng()),
    }),
    init: () => ({}),
    update: noop,
    // the stars themselves belong to the starfield (see Scene.composeStars)
    anchors(it, sc) {
      const R = (sz("constellation", it, sc) / 2) * 0.95;
      const big = it.p.shape.big as number[];
      return constellationPoints(it, sc).map(([x, y], i) => ({ x, y, big: big.includes(i), snap: R * 0.28 }));
    },
    // ...so the object only draws the lines joining them, stopping just short of each star
    draw(it, sc, g, t, k) {
      if (k < 0.02) return;
      const p = it.p;
      const P = constellationPoints(it, sc);
      const lineCol = mix(C.dust, p.pal.line, k);
      const trim = Math.max(g.cw, sc.cfg.stars.size * 0.65);
      (p.shape.edges as [number, number][]).forEach(([a, b], e) => {
        const A = P[a];
        const B = P[b];
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const len = Math.hypot(dx, dy);
        if (len <= trim * 2) return;
        const ch = lineCh(dx, dy);
        const I = (0.72 + 0.1 * Math.sin(t * 1.3 + e * 1.9 + p.ph)) * k;
        for (let d = trim; d <= len - trim; d += 1.1) g.plot(A[0] + (dx * d) / len, A[1] + (dy * d) / len, I, lineCol, ch);
      });
    },
  };

  return [galaxy, comet, ship, planet, pulsar, blackhole, constellation];
}

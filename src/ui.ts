import type { App } from "./app";
import { MAX_SEED } from "./random";
import { OBJECT_META } from "./universe/config";
import { MAX_PER_TYPE } from "./universe/scene";
import { OBJECT_IDS } from "./universe/types";
import type { ObjectId, SceneConfig } from "./universe/types";

type Attrs = Record<string, string | number | boolean | undefined>;

/** Tiny element builder. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...kids);
  return el;
}

const pad6 = (n: number) => String(n).padStart(6, "0");
const pct = (v: number) => `${Math.round(v * 100)}%`;

type Control = { el: HTMLElement; sync: () => void };

function slider(
  label: string,
  o: { min: number; max: number; step: number; get: () => number; set: (v: number) => void; fmt?: (v: number) => string; hideLabel?: boolean },
): Control {
  const fmt = o.fmt ?? String;
  const input = h("input", { type: "range", min: o.min, max: o.max, step: o.step, "aria-label": label });
  const out = h("output", { class: "val" });
  const el = h("label", { class: o.hideLabel ? "row row-bare" : "row" }, ...(o.hideLabel ? [] : [h("span", { class: "lbl" }, label)]), input, out);
  input.addEventListener("input", () => {
    const v = +input.value;
    out.textContent = fmt(v);
    o.set(v);
  });
  return {
    el,
    sync() {
      const v = o.get();
      input.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

function button(label: string, cls: string, onClick: () => void) {
  const b = h("button", { type: "button", class: `btn ${cls}` }, label);
  b.addEventListener("click", onClick);
  return b;
}

function panel(cls: string, title: string | Node, ...body: (Node | string)[]) {
  return h("section", { class: `panel ${cls}` }, h("h2", { class: "plate" }, title), ...body);
}

/** Builds the control deck under the screen and keeps it, and the on-screen readouts, in step with the app. */
export function mountUi(app: App, deck: HTMLElement) {
  const controls: Control[] = [];
  const track = <T extends Control>(c: T) => (controls.push(c), c);
  const cfg = () => app.state.config;
  const patch = (fn: (c: SceneConfig) => SceneConfig) => app.patchConfig(fn);

  /* ── Generate ── */
  const seedInput = h("input", { class: "lcd", inputmode: "numeric", maxlength: 6, "aria-label": "Seed", spellcheck: false });
  seedInput.addEventListener("change", () => {
    const n = parseInt(seedInput.value.replace(/\D/g, ""), 10);
    if (Number.isFinite(n)) app.generate(Math.min(MAX_SEED, n));
    else syncAll();
  });
  seedInput.addEventListener("focus", () => seedInput.select());

  const autopilot = h("button", { type: "button", class: "btn toggle", "aria-pressed": false }, h("i", { class: "led", "aria-hidden": true }), "Autopilot");
  autopilot.addEventListener("click", () => app.setAutopilot(!app.state.autopilot));

  const wake = track(slider("Awake at start", { min: 0, max: 1, step: 0.05, get: () => app.state.wakeShare, set: (v) => app.setWakeShare(v), fmt: pct }));

  const generate = panel(
    "gen",
    "Generate",
    h("div", { class: "seed" }, h("span", { class: "cap" }, "Seed"), seedInput),
    h("div", { class: "seed-keys" }, button("◀", "step", () => app.step(-1)), button("Randomize", "primary", () => app.randomize()), button("▶", "step", () => app.step(1))),
    autopilot,
    wake.el,
  );

  /* ── Starfield ── */
  const stars = panel(
    "stars",
    "Starfield",
    ...[
      slider("Density", { min: 0, max: 40, step: 0.5, get: () => cfg().stars.hero, set: (v) => patch((c) => ({ ...c, stars: { ...c.stars, hero: v } })) }),
      slider("Star size", { min: 4, max: 14, step: 0.5, get: () => cfg().stars.size, set: (v) => patch((c) => ({ ...c, stars: { ...c.stars, size: v } })), fmt: (v) => `${v}px` }),
      slider("Twinkle", { min: 0, max: 1, step: 0.05, get: () => cfg().stars.twinkle, set: (v) => patch((c) => ({ ...c, stars: { ...c.stars, twinkle: v } })), fmt: pct }),
      slider("Colour tint", { min: 0, max: 0.5, step: 0.01, get: () => cfg().stars.tint, set: (v) => patch((c) => ({ ...c, stars: { ...c.stars, tint: v } })), fmt: pct }),
      slider("Bloom", { min: 0, max: 1, step: 0.05, get: () => cfg().bloom, set: (v) => patch((c) => ({ ...c, bloom: v })), fmt: pct }),
      slider("Glyph size", { min: 3, max: 8, step: 0.5, get: () => cfg().glyph, set: (v) => patch((c) => ({ ...c, glyph: v })), fmt: (v) => `${v}px` }),
      slider("Speed", { min: 0.1, max: 2, step: 0.05, get: () => cfg().speed, set: (v) => patch((c) => ({ ...c, speed: v })), fmt: (v) => `${v.toFixed(2)}×` }),
    ].map((s) => track(s).el),
  );

  /* ── Objects ── */
  let selected: ObjectId = "galaxy";
  const leds = new Map<ObjectId, HTMLElement>();
  const tallies = new Map<ObjectId, HTMLElement>();
  const nameButtons = new Map<ObjectId, HTMLButtonElement>();

  const rows = OBJECT_IDS.map((id) => {
    const led = h("i", { class: "led", "aria-hidden": true });
    const name = h("button", { type: "button", class: "obj-name", "aria-pressed": id === selected }, OBJECT_META[id].name);
    const tally = h("span", { class: "tally", title: "awake / total" }, "0/0");
    leds.set(id, led);
    tallies.set(id, tally);
    nameButtons.set(id, name);
    name.addEventListener("click", () => {
      selected = id;
      syncAll();
    });
    const count = track(
      slider(`${OBJECT_META[id].name} count`, {
        min: 0,
        max: MAX_PER_TYPE,
        step: 1,
        hideLabel: true,
        get: () => cfg().objects[id].count,
        set: (v) => patch((c) => ({ ...c, objects: { ...c.objects, [id]: { ...c.objects[id], count: v } } })),
      }),
    );
    return h("div", { class: "obj-row" }, led, name, tally, count.el);
  });
  const objects = panel("objs", "Objects", ...rows, h("p", { class: "note" }, "Green light: at least one of that kind is awake."));

  /* ── Tuning (size and speed of the selected kind) ── */
  const tuneTitle = h("span", {}, "Tuning");
  const tuneNote = h("p", { class: "note" });
  const tune = panel(
    "tune",
    tuneTitle,
    track(
      slider("Size", {
        min: 20,
        max: 140,
        step: 2,
        get: () => cfg().objects[selected].size,
        set: (v) => patch((c) => ({ ...c, objects: { ...c.objects, [selected]: { ...c.objects[selected], size: v } } })),
        fmt: (v) => `${v}px`,
      }),
    ).el,
    track(
      slider("Speed", {
        min: 0.1,
        max: 2.5,
        step: 0.05,
        get: () => cfg().objects[selected].speed,
        set: (v) => patch((c) => ({ ...c, objects: { ...c.objects, [selected]: { ...c.objects[selected], speed: v } } })),
        fmt: (v) => `${v.toFixed(2)}×`,
      }),
    ).el,
    tuneNote,
  );

  /* ── Actions and readouts ── */
  const copy = button("Copy link", "", async () => {
    const ok = await app.copyLink();
    copy.textContent = ok ? "Copied" : "Copy failed";
    window.setTimeout(() => (copy.textContent = "Copy link"), 1500);
  });
  const readout = {
    stars: h("output", { class: "val" }, "0"),
    objects: h("output", { class: "val" }, "0"),
    awake: h("output", { class: "val" }, "0"),
    fps: h("output", { class: "val" }, "60"),
  };
  const line = (name: string, out: HTMLElement) => h("li", {}, h("span", {}, name), out);
  const actions = panel(
    "act",
    "Controls",
    h("div", { class: "btn-grid" }, button("Wake all", "go", () => app.wakeAll()), button("Snapshot", "", () => app.snapshot()), copy, button("Reset", "warn", () => app.sleepAll())),
    h("ul", { class: "readouts" }, line("Stars", readout.stars), line("Objects", readout.objects), line("Awake", readout.awake), line("FPS", readout.fps)),
  );

  deck.replaceChildren(generate, stars, objects, tune, actions);

  /* ── Keeping everything in step ── */
  const hud = {
    seed: document.getElementById("hud-seed")!,
    objects: document.getElementById("hud-objects")!,
    awake: document.getElementById("hud-awake")!,
    hint: document.getElementById("hud-hint")!,
  };
  hud.hint.textContent = matchMedia("(pointer: coarse)").matches ? "Tap an object to wake it" : "Click an object to wake it";

  const syncLive = () => {
    const items = app.scene.items;
    const awake = items.filter((it) => it.awake).length;
    hud.objects.textContent = String(items.length);
    hud.awake.textContent = String(awake);
    readout.objects.textContent = String(items.length);
    readout.awake.textContent = String(awake);
    readout.stars.textContent = String(app.scene.starCount);
    readout.fps.textContent = String(Math.round(app.fps));
    for (const id of OBJECT_IDS) {
      const of = items.filter((it) => it.def.id === id);
      const a = of.filter((it) => it.awake).length;
      leds.get(id)!.classList.toggle("on", a > 0);
      tallies.get(id)!.textContent = `${a}/${of.length}`;
    }
  };

  function syncAll() {
    const s = app.state;
    seedInput.value = pad6(s.seed);
    hud.seed.textContent = pad6(s.seed);
    autopilot.setAttribute("aria-pressed", String(s.autopilot));
    autopilot.querySelector(".led")!.classList.toggle("on", s.autopilot);
    nameButtons.forEach((b, id) => b.setAttribute("aria-pressed", String(id === selected)));
    tuneTitle.textContent = `Tuning · ${OBJECT_META[selected].name}`;
    tuneNote.textContent = OBJECT_META[selected].note;
    controls.forEach((c) => c.sync());
    syncLive();
  }

  app.onChange(syncAll);
  window.setInterval(syncLive, 300);
  syncAll();
}

# Random Universe Generator

A tiny browser toy that makes a random universe out of ASCII characters: spiral galaxies, comets, ringed planets, pulsars, black holes, rockets, satellites and real constellations. Hit **Randomize** for a new sky; the same seed always gives the same one.

The interface is a retro spaceship control panel: a rectangular viewport on top and a deck of controls underneath. On a desktop-sized window the screen and every control fit in one view, with no scrolling.

![The Random Universe Generator](docs/screenshot.jpg)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-checks, then builds to dist/
npm run preview    # serves the built site
```

No framework: TypeScript, Vite, a canvas and some CSS.

## What you can do

| Control | What it does |
| --- | --- |
| **Randomize** (or <kbd>R</kbd>) | Generates a new universe from a random six-digit seed. |
| **◀ / ▶** | Steps to the previous or next seed. |
| **Seed display** | Click it and type a seed to jump straight to that universe. |
| **Shuffle** (or <kbd>S</kbd>) | Keeps every setting exactly as it is and re-rolls only the seed: new positions and variations, same knobs. |
| **Autopilot** (or <kbd>A</kbd>) | Flies to a new universe every few seconds. |
| **Starfield** | Star density (up to 50 per 100k px²), star size (up to 20px), twinkle, colour tint, bloom (0–20%), glyph size and overall speed. |
| **Objects** | How many of each of the seven kinds. Click a name to tune that kind's size and speed in the Tuning panel. |
| **Snapshot** | Saves the current view as a PNG. |
| **Copy link** | Copies a link to this exact universe. |

### Same seed, same universe

The address bar always describes what you're looking at: `#seed=424242`. Open that link anywhere and you get the same sky: the same objects, varied the same way. Where they sit depends on the size of the viewport, so the layout matches at the same window size. If you change any setting by hand, the link also carries those settings, so what you share is what you see.

## The objects

Every object in a universe is its own variation of its kind.

- **Spiral galaxy**: four spiral types (grand-design, barred, ring, single-arm), each seen from its own angle, with its own palette and slow spin.
- **Comet**: a round head and a fan of dashes streaming away like a blast.
- **Spacecraft**: rockets that trail flame and smoke, and satellites with solar wings, drifting on slow curves, lines and orbits.
- **Ringed planet**: banded gas giants with storms and one to three rings, seen from different angles.
- **Pulsar**: a six-ray star that beats and sends a ring across the sky, lighting the stars it passes.
- **Black hole**: a spinning accretion disk, with the nearby stars pulled in close around it.
- **Constellation**: Orion, Scorpius, the Big Dipper, Cassiopeia, Leo and Cygnus, placed from real star positions. Their stars are ordinary stars of the starfield (a nearby scattered star is absorbed, so the sky doesn't thicken around them) and the constellation just joins them with lines.

## How it works

- The sky is a grid of character cells. Each frame, every object paints glyphs into that grid (brightness picks the character, and a palette colour is attached), then the grid is drawn to a `<canvas>`. A soft bloom is added on top for the glowing objects.
- A seed drives everything: the settings (`src/random.ts`), where each object sits, and how each one varies. The engine lives in `src/universe/` (`scene.ts` places things and runs the frame, `objects.ts` draws the seven kinds).
- The colours are CSS custom properties (`--color-cosmos-*` in `src/style.css`); the engine reads them at start-up, so re-theming the universe is a CSS edit.
- It respects `prefers-reduced-motion`: with it on, everything holds still.


## License

MIT, see [LICENSE](LICENSE).

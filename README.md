# Attention RWA — Scripted (v3)

Separate from **Claude - v2** (emergent simulation). This project keeps the same visual language but drives extrusions from lightweight **scripted timelines** that regenerate forever.

## Idea

- Lattice is static (baked to CSS once).
- p5 stays alive in the background — no final freeze / teardown.
- Extrusions are still scripted cells, but waves overlap: some regions rise while others fall.
- Each cell has its own rise → hold → reverse clock; new waves keep spawning.
- Red signals wander continuously for atmosphere; they do **not** build anything.

## Rhythm

- Waves stagger cells over ~10s (`waveHorizonMs`)
- New waves arrive every ~2.8–5.2s so motion never fully dies
- Per-cell hold ~1.4–5.6s, then gradual reverse
- Surface / extrusion anims are slowed for a softer ease

Tune in `theme.js` → `lifecycle` and `surface`.

## Edit generation

Open `script.js` → `generateExtrusionWave()` to change cluster counts, lattice range, heights, or scatter odds.

Each cell:

```js
{ ci: 2, cj: 1, heightPx: 64, startMs: 2500, holdMs: 3200 }
```

- `ci`, `cj` — lattice cell indices  
- `heightPx` — extrusion height  
- `startMs` — delay from wave spawn before rising  
- `holdMs` — how long it stays fully up before reversing

## Run locally

Serve the folder (ES modules need a local server), e.g.:

```bash
npx serve .
```

Then open the URL shown.

## Webflow embed

Repo: [wicknfable/canvas-effect-v2](https://github.com/wicknfable/canvas-effect-v2)

Host div in Webflow: **id** `canvas-container` (class `canvas-container` optional).

**Head code**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wicknfable/canvas-effect-v2@main/style.css" />
```

**Footer code**

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/gh/wicknfable/canvas-effect-v2@main/sketch.js"></script>
```

Publish the site to test — custom code usually does not run in Designer preview.

## Files

| File | Role |
|------|------|
| `script.js` | Procedural extrusion script generator |
| `player.js` | Breathing clock + decorative signals |
| `renderer.js` | Draw / lattice bake |
| `sketch.js` | Mount + continuous loop |
| `theme.js` | Palette / timing |
| `grid.js` / `camera.js` | Lattice math |

Claude - v2 is unchanged.

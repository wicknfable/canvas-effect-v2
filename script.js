/**
 * script.js
 * ------------------------------------------------------------------------
 * Procedural extrusion waves — authored as cell timelines, regenerated
 * continuously so the lattice stays in motion.
 *
 * Returns cells (for extrusion clocks) plus clusters (for escort signals).
 * ------------------------------------------------------------------------
 */

/**
 * @typedef {{
 *   ci: number,
 *   cj: number,
 *   heightPx: number,
 *   startMs: number,
 *   holdMs: number,
 * }} ScriptCell
 *
 * @typedef {{
 *   cells: ScriptCell[],
 *   originCi: number,
 *   originCj: number,
 *   baseMs: number,
 * }} ScriptCluster
 *
 * @typedef {{
 *   cells: ScriptCell[],
 *   clusters: ScriptCluster[],
 * }} ExtrusionWave
 */

/** Short stubs through mid blocks to rare tall spikes. */
const HEIGHTS_SHORT = [8, 12, 16, 22, 28];
const HEIGHTS_MID = [34, 42, 52, 64, 78];
// Tall spikes (~20% lower than prior max range).
const HEIGHTS_TALL = [77, 94, 114, 134, 157];

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Weighted height pick. Profiles bias a cluster's silhouette.
 * @param {'low' | 'mid' | 'mixed' | 'spike' | 'skyline'} profile
 */
function pickHeight(profile) {
  const r = Math.random();
  if (profile === 'low') {
    return r < 0.85 ? pick(HEIGHTS_SHORT) : pick(HEIGHTS_MID);
  }
  if (profile === 'mid') {
    if (r < 0.15) return pick(HEIGHTS_SHORT);
    if (r < 0.9) return pick(HEIGHTS_MID);
    return pick(HEIGHTS_TALL);
  }
  if (profile === 'spike') {
    // One tall outlier is applied separately; neighbors stay low/mid.
    return r < 0.7 ? pick(HEIGHTS_SHORT) : pick(HEIGHTS_MID);
  }
  if (profile === 'skyline') {
    // Strong contrast inside the cluster.
    if (r < 0.35) return pick(HEIGHTS_SHORT);
    if (r < 0.7) return pick(HEIGHTS_MID);
    return pick(HEIGHTS_TALL);
  }
  // mixed — wide spread, still mostly mid
  if (r < 0.28) return pick(HEIGHTS_SHORT);
  if (r < 0.78) return pick(HEIGHTS_MID);
  return pick(HEIGHTS_TALL);
}

function pickClusterProfile() {
  const r = Math.random();
  if (r < 0.22) return 'low';
  if (r < 0.42) return 'mid';
  if (r < 0.62) return 'mixed';
  if (r < 0.82) return 'skyline';
  return 'spike';
}

function pickHoldMs(heightPx) {
  // Taller blocks tend to linger a bit longer, but not always.
  if (heightPx >= 110) return randInt(2800, 8200);
  if (heightPx >= 64) return randInt(1600, 6400);
  if (heightPx <= 22) return randInt(700, 3200);
  return randInt(1100, 5200);
}

/**
 * One wave: a few clusters and/or scatter, staggered over several seconds.
 * @param {{ occupied?: Set<string>, horizonMs?: number }} [opts]
 * @returns {ExtrusionWave}
 */
export function generateExtrusionWave(opts = {}) {
  const occupied = opts.occupied || new Set();
  const horizonMs = opts.horizonMs ?? 9000;
  /** @type {Map<string, ScriptCell>} */
  const byKey = new Map();
  /** @type {ScriptCluster[]} */
  const clusters = [];

  const modeRoll = Math.random();
  const clusterCount =
    modeRoll < 0.18 ? 1 :
    modeRoll < 0.55 ? randInt(2, 3) :
    modeRoll < 0.85 ? randInt(2, 4) :
    randInt(3, 5);

  for (let c = 0; c < clusterCount; c++) {
    const originCi = randInt(-8, 8);
    const originCj = randInt(-6, 6);
    const size = randInt(2, 8);
    const radius = Math.random() < 0.35 ? 1 : Math.random() < 0.75 ? 2 : 3;
    const baseMs = Math.floor((c / Math.max(1, clusterCount)) * horizonMs * 0.55)
      + randInt(0, Math.floor(horizonMs * 0.25));
    const profile = pickClusterProfile();

    /** @type {ScriptCell[]} */
    const group = [];
    for (let n = 0; n < size; n++) {
      const ci = originCi + randInt(-radius, radius);
      const cj = originCj + randInt(-radius, radius);
      const key = `${ci},${cj}`;
      if (occupied.has(key) || byKey.has(key)) continue;
      const heightPx = pickHeight(profile);
      const cell = {
        ci,
        cj,
        heightPx,
        startMs: baseMs + n * randInt(200, 1100) + randInt(0, 500),
        holdMs: pickHoldMs(heightPx),
      };
      byKey.set(key, cell);
      group.push(cell);
    }

    // Spike profile: force one clear tall hero in the group.
    if (profile === 'spike' && group.length) {
      const hero = group[Math.floor(Math.random() * group.length)];
      hero.heightPx = pick(HEIGHTS_TALL);
      hero.holdMs = pickHoldMs(hero.heightPx);
    }

    if (group.length) {
      clusters.push({ cells: group, originCi, originCj, baseMs });
    }
  }

  // Loose scatter — often the only motion in quieter waves.
  /** @type {ScriptCell[]} */
  const scatter = [];
  if (Math.random() < 0.9 || byKey.size < 4) {
    const scatterCount = randInt(3, 9);
    for (let i = 0; i < scatterCount; i++) {
      const ci = randInt(-9, 9);
      const cj = randInt(-7, 7);
      const key = `${ci},${cj}`;
      if (occupied.has(key) || byKey.has(key)) continue;
      const heightPx = pickHeight(Math.random() < 0.55 ? 'low' : 'mixed');
      const cell = {
        ci,
        cj,
        heightPx,
        startMs: randInt(200, horizonMs),
        holdMs: pickHoldMs(heightPx),
      };
      byKey.set(key, cell);
      scatter.push(cell);
    }
  }

  // Occasional lone monument — very tall, holds longer.
  if (Math.random() < 0.55) {
    const ci = randInt(-9, 9);
    const cj = randInt(-7, 7);
    const key = `${ci},${cj}`;
    if (!occupied.has(key) && !byKey.has(key)) {
      const heightPx = pick(HEIGHTS_TALL);
      const cell = {
        ci,
        cj,
        heightPx,
        startMs: randInt(600, horizonMs),
        holdMs: randInt(3200, 9000),
      };
      byKey.set(key, cell);
      scatter.push(cell);
    }
  }

  // Scatter becomes small escort targets (singles / pairs), not one line per cell.
  if (scatter.length) {
    shuffleInPlace(scatter);
    for (let i = 0; i < scatter.length; ) {
      const take = Math.min(scatter.length - i, Math.random() < 0.45 ? 2 : 1);
      const group = scatter.slice(i, i + take);
      i += take;
      // Skip some lone scatter so lines stay sparse.
      if (group.length === 1 && Math.random() < 0.4) continue;
      const first = group[0];
      clusters.push({
        cells: group,
        originCi: first.ci,
        originCj: first.cj,
        baseMs: Math.min(...group.map((c) => c.startMs)),
      });
    }
  }

  const cells = [...byKey.values()];
  for (const cell of cells) {
    cell.startMs = Math.max(80, cell.startMs + randInt(-280, 420));
    cell.holdMs = Math.max(600, cell.holdMs);
  }

  cells.sort((a, b) => a.startMs - b.startMs);
  return { cells, clusters };
}

/** @deprecated use generateExtrusionWave */
export function generateExtrusionScript() {
  return generateExtrusionWave({ horizonMs: 10000 }).cells;
}

export const EXTRUSION_SCRIPT = generateExtrusionWave({ horizonMs: 10000 }).cells;

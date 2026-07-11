/**
 * player.js
 * ------------------------------------------------------------------------
 * Continuous overlapping extrusion player.
 *
 * Causality (cheap): one escort pulse per cluster approaches the block
 * (optional hero perimeter), then keeps traveling as a wanderer. Extrusion
 * clocks stay authoritative — lines are choreographed nearby, not reactive.
 * ------------------------------------------------------------------------
 */

import { Theme } from './theme.js';
import { latticeToWorld, cellWorldCorners, cellWorldCenter } from './grid.js';
import { generateExtrusionWave } from './script.js';

const EDGE = Theme.grid.spacing;
const PROGRESS_PER_MS = Theme.signal.speedWorldPerSec / (EDGE * 1000);
const EDGE_MS = (EDGE / Theme.signal.speedWorldPerSec) * 1000;

const NEIGHBOURS = [
  { di: 1, dj: 0 },
  { di: -1, dj: 0 },
  { di: 0, dj: 1 },
  { di: 0, dj: -1 },
];

const CELL = {
  WAITING: 'waiting',
  RISING: 'rising',
  HOLDING: 'holding',
  FALLING: 'falling',
  DONE: 'done',
};

function easeInOutCubic(t) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function easeInOutQuad(t) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
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

/** Axis-aligned walk — no search, O(|di|+|dj|). */
function manhattanPath(fromI, fromJ, toI, toJ) {
  const path = [{ i: fromI, j: fromJ }];
  let i = fromI;
  let j = fromJ;
  // Mix axis order so approaches don't always look L-shaped the same way.
  const iFirst = Math.random() < 0.5;
  const stepI = () => {
    while (i !== toI) {
      i += Math.sign(toI - i);
      path.push({ i, j });
    }
  };
  const stepJ = () => {
    while (j !== toJ) {
      j += Math.sign(toJ - j);
      path.push({ i, j });
    }
  };
  if (iFirst) {
    stepI();
    stepJ();
  } else {
    stepJ();
    stepI();
  }
  return path;
}

/** Closed diamond for cell (ci,cj), random start + CW/CCW. */
function cellPerimeterPath(ci, cj) {
  const corners = [
    { i: ci, j: cj },
    { i: ci + 1, j: cj },
    { i: ci + 1, j: cj + 1 },
    { i: ci, j: cj + 1 },
  ];
  const start = Math.floor(Math.random() * 4);
  const cw = Math.random() < 0.5;
  const path = [];
  for (let k = 0; k <= 4; k++) {
    const idx = cw ? (start + k) % 4 : (((start - k) % 4) + 4) % 4;
    path.push(corners[idx]);
  }
  return path;
}

/**
 * Approach from outside + optional hero perimeter.
 * Returns lattice nodes (polyline), length >= 2.
 */
function buildEscortPath(cluster) {
  const hero = cluster.cells.reduce((a, b) => (a.startMs <= b.startMs ? a : b));
  const approachMin = Theme.signal.approachEdgesMin ?? 5;
  const approachMax = Theme.signal.approachEdgesMax ?? 9;
  const dist = randInt(approachMin, approachMax);
  const dir = NEIGHBOURS[Math.floor(Math.random() * NEIGHBOURS.length)];

  const startI = hero.ci - dir.di * dist;
  const startJ = hero.cj - dir.dj * dist;
  // Arrive at a corner of the hero cell.
  const corner = Math.floor(Math.random() * 4);
  const targetI = hero.ci + (corner === 1 || corner === 2 ? 1 : 0);
  const targetJ = hero.cj + (corner === 2 || corner === 3 ? 1 : 0);

  let path = manhattanPath(startI, startJ, targetI, targetJ);

  const doPerimeter = Math.random() < (Theme.signal.perimeterChance ?? 0.55);
  if (doPerimeter) {
    const loop = cellPerimeterPath(hero.ci, hero.cj);
    // Align loop so it starts at current path end.
    const end = path[path.length - 1];
    let align = loop.findIndex((n) => n.i === end.i && n.j === end.j);
    if (align < 0) align = 0;
    const rotated = [];
    for (let k = 0; k <= 4; k++) {
      rotated.push(loop[(align + k) % 4]);
    }
    // Skip duplicate join node.
    path = path.concat(rotated.slice(1));
  }

  return { path, hero, edgeCount: path.length - 1 };
}

export class Player {
  constructor() {
    this.timeMs = 0;

    /** @type {Array} */
    this.platforms = [];
    /** @type {Set<string>} */
    this._occupied = new Set();

    /** @type {Array} */
    this.signals = [];
    /** @type {Array} */
    this._pendingEscorts = [];

    this._spawnCooldown = 400;
    this._waveCooldown = 200;

    this._drawSurfaces = [];
    this._drawSignals = [];
    this._drawResiduals = [];
    /** @type {Map<string, { i1: number, j1: number, i2: number, j2: number, strength: number }>} */
    this._residuals = new Map();

    this._injectWave();
  }

  update(deltaMs) {
    const dt = Math.min(deltaMs, 50);
    this.timeMs += dt;

    this._advancePlatforms(dt);
    this._pruneDone();
    this._tryInjectWave(dt);

    this._flushPendingEscorts();
    this._updateSignals(dt);
    this._decayResiduals(dt);
    if (Theme.signal.wanderEnabled) this._trySpawnSignal(dt);
  }

  getDrawData() {
    return {
      surfaces: this._buildSurfaces(),
      signals: this._buildSignalGeometry(),
      residuals: this._buildResiduals(),
    };
  }

  _cellKey(ci, cj) {
    return `${ci},${cj}`;
  }

  _tryInjectWave(dt) {
    this._waveCooldown -= dt;
    if (this._waveCooldown > 0) return;

    const maxCells = Theme.lifecycle.maxActiveCells ?? 28;
    if (this.platforms.length >= maxCells) {
      this._waveCooldown = 600;
      return;
    }

    this._injectWave();
    this._waveCooldown = randRange(
      Theme.lifecycle.waveGapMinMs ?? 2200,
      Theme.lifecycle.waveGapMaxMs ?? 4800
    );
  }

  _injectWave() {
    const horizon = Theme.lifecycle.waveHorizonMs ?? 10000;
    const wave = generateExtrusionWave({
      occupied: this._occupied,
      horizonMs: horizon,
    });

    const lead = Theme.signal.escortLeadMs ?? 180;

    for (const entry of wave.cells) {
      const key = this._cellKey(entry.ci, entry.cj);
      if (this._occupied.has(key)) continue;

      const corners = cellWorldCorners(entry.ci, entry.cj);
      this._occupied.add(key);
      this.platforms.push({
        key,
        ci: entry.ci,
        cj: entry.cj,
        heightPx: entry.heightPx,
        riseAt: this.timeMs + entry.startMs,
        holdMs: entry.holdMs,
        holdUntil: 0,
        corners,
        center: cellWorldCenter(corners),
        phase: CELL.WAITING,
        surfaceProgress: 0,
        extrusionProgress: 0,
      });
    }

    // One escort line per cluster — approach, maybe loop, then keep going.
    for (const cluster of wave.clusters) {
      if (!cluster.cells.length) continue;
      const { path, hero, edgeCount } = buildEscortPath(cluster);
      if (edgeCount < 1) continue;

      const riseAt = this.timeMs + hero.startMs;
      const travelMs = edgeCount * EDGE_MS;
      // Prefer arriving as the hero cell begins rising.
      let startAt = riseAt - travelMs - lead;
      if (startAt < this.timeMs) startAt = this.timeMs;

      this._pendingEscorts.push({ startAt, path });
    }
  }

  _flushPendingEscorts() {
    if (!this._pendingEscorts.length) return;

    const max = Theme.signal.escortMaxConcurrent ?? 5;
    const activeEscorts = this.signals.reduce(
      (n, s) => n + (s.kind === 'escort' ? 1 : 0),
      0
    );
    let slots = Math.max(0, max - activeEscorts);
    if (slots <= 0) return;

    const keep = [];
    for (const pending of this._pendingEscorts) {
      if (pending.startAt > this.timeMs) {
        keep.push(pending);
        continue;
      }
      if (slots <= 0) continue;
      this._spawnEscort(pending.path);
      slots--;
    }
    this._pendingEscorts = keep;
  }

  _spawnEscort(path) {
    const from = path[0];
    const to = path[1];
    const di = to.i - from.i;
    const dj = to.j - from.j;
    const continueMin = Theme.signal.continueMinEdges ?? 28;
    const continueMax = Theme.signal.continueMaxEdges ?? 52;

    this.signals.push({
      kind: 'escort',
      path,
      edgeIndex: 0,
      from: { ...from },
      to: { ...to },
      heading: { di, dj },
      progress: 0,
      trail: [{ ...from }],
      // After the scripted approach, keep traveling this many more edges.
      continueEdges: randInt(continueMin, continueMax),
      edgesTraversed: 0,
      maxEdges: 0,
      accent: 1,
      depth: 0,
      usedEdges: new Set([edgeKey(from.i, from.j, to.i, to.j)]),
    });
  }

  _promoteEscortToWander(s) {
    s.kind = 'wander';
    s.path = null;
    s.edgeIndex = 0;
    s.edgesTraversed = 0;
    s.maxEdges = s.continueEdges;
    // Accent starts fading on the continue phase (see _updateSignals).
  }

  _accentFor(s) {
    if (s.kind === 'escort') return 1;
    // Branches keep whatever accent they inherited; only fade root continues.
    if ((s.depth ?? 0) > 0) return s.accent ?? 0;
    const fade = Theme.signal.accentFadeEdges ?? 10;
    if (fade <= 0) return 0;
    return Math.max(0, 1 - s.edgesTraversed / fade);
  }

  /** Turn headings that aren't forward or reverse of `heading`. */
  _sideHeadings(heading) {
    return NEIGHBOURS.filter(
      (n) => !(n.di === heading.di && n.dj === heading.dj)
        && !(n.di === -heading.di && n.dj === -heading.dj)
    );
  }

  /**
   * Maybe spawn 1–2 short side pulses from junction `at`.
   * Pushes into `spawned` (applied after the update loop).
   */
  _maybeBranch(parent, at, spawned) {
    const maxTotal = Theme.signal.maxSignalsTotal ?? 14;
    const live = this.signals.length + spawned.length;
    if (live >= maxTotal) return;

    const depth = parent.depth ?? 0;
    const maxDepth = Theme.signal.branchMaxDepth ?? 2;
    if (depth >= maxDepth) return;

    const chance = depth === 0
      ? (Theme.signal.branchChance ?? 0.14)
      : (Theme.signal.branchChanceOnBranch ?? 0.05);
    if (Math.random() > chance) return;

    const sides = this._sideHeadings(parent.heading);
    if (!sides.length) return;
    shuffleInPlace(sides);

      const countMax = Theme.signal.branchCountMax ?? 2;
    // ~50% of forks spawn a second branch when allowed.
    const count = 1 + (Math.random() < 0.5 && countMax > 1 ? 1 : 0);
    const minE = Theme.signal.branchMinEdges ?? 8;
    const maxE = Theme.signal.branchMaxEdges ?? 20;

    for (let i = 0; i < count && i < sides.length; i++) {
      if (this.signals.length + spawned.length >= maxTotal) break;
      const heading = sides[i];
      const to = { i: at.i + heading.di, j: at.j + heading.dj };
      spawned.push({
        kind: 'wander',
        from: { ...at },
        to,
        heading: { ...heading },
        progress: 0,
        edgesTraversed: 0,
        maxEdges: randInt(minE, maxE),
        // Inherit current accent so red roots fork red, faded roots fork grey.
        accent: parent.accent ?? this._accentFor(parent),
        depth: depth + 1,
        trail: [{ ...at }],
        usedEdges: new Set([edgeKey(at.i, at.j, to.i, to.j)]),
      });
    }
  }

  _advancePlatforms(dt) {
    const surfDur = Theme.surface.animDurationMs;
    const extDur = Theme.surface.extrusionDurationMs;
    const riseRate = dt / surfDur;
    const extRate = dt / extDur;

    for (const p of this.platforms) {
      if (p.phase === CELL.DONE) continue;

      if (p.phase === CELL.WAITING) {
        if (this.timeMs < p.riseAt) continue;
        p.phase = CELL.RISING;
      }

      if (p.phase === CELL.RISING) {
        if (p.surfaceProgress < 1) {
          p.surfaceProgress = Math.min(1, p.surfaceProgress + riseRate);
        } else if (p.extrusionProgress < 1) {
          p.extrusionProgress = Math.min(1, p.extrusionProgress + extRate);
        } else {
          p.phase = CELL.HOLDING;
          p.holdUntil = this.timeMs + p.holdMs;
        }
        continue;
      }

      if (p.phase === CELL.HOLDING) {
        if (this.timeMs >= p.holdUntil) {
          p.phase = CELL.FALLING;
        }
        continue;
      }

      if (p.phase === CELL.FALLING) {
        if (p.extrusionProgress > 0) {
          p.extrusionProgress = Math.max(0, p.extrusionProgress - extRate);
        } else if (p.surfaceProgress > 0) {
          p.surfaceProgress = Math.max(0, p.surfaceProgress - riseRate);
        } else {
          p.phase = CELL.DONE;
        }
      }
    }
  }

  _pruneDone() {
    if (!this.platforms.some((p) => p.phase === CELL.DONE)) return;
    const next = [];
    for (const p of this.platforms) {
      if (p.phase === CELL.DONE) {
        this._occupied.delete(p.key);
        continue;
      }
      next.push(p);
    }
    this.platforms = next;
  }

  _trySpawnSignal(dt) {
    this._spawnCooldown -= dt;
    const max = Theme.signal.maxConcurrent;
    if (this._spawnCooldown > 0) return;

    const wanderCount = this.signals.reduce(
      (n, s) => n + (s.kind === 'wander' ? 1 : 0),
      0
    );
    if (wanderCount >= max) {
      this._spawnCooldown = 800;
      return;
    }
    this._spawnSignal();
    this._spawnCooldown = 1400 + Math.random() * 2000;
  }

  _spawnSignal() {
    const heading = NEIGHBOURS[Math.floor(Math.random() * NEIGHBOURS.length)];
    let si;
    let sj;
    if (heading.di === 1) {
      si = -10 + Math.floor(Math.random() * 4);
      sj = -6 + Math.floor(Math.random() * 13);
    } else if (heading.di === -1) {
      si = 7 + Math.floor(Math.random() * 4);
      sj = -6 + Math.floor(Math.random() * 13);
    } else if (heading.dj === 1) {
      si = -8 + Math.floor(Math.random() * 17);
      sj = -8 + Math.floor(Math.random() * 4);
    } else {
      si = -8 + Math.floor(Math.random() * 17);
      sj = 5 + Math.floor(Math.random() * 4);
    }

    if (Math.random() < 0.35 && this.platforms.length) {
      const live = this.platforms.filter((p) => p.phase !== CELL.WAITING && p.phase !== CELL.DONE);
      const pool = live.length ? live : this.platforms;
      const seed = pool[Math.floor(Math.random() * pool.length)];
      si = seed.ci - heading.di * (2 + Math.floor(Math.random() * 4));
      sj = seed.cj - heading.dj * (2 + Math.floor(Math.random() * 4));
    }

    const minEdges = Theme.signal.minEdges ?? 28;
    const maxEdgesCap = Theme.signal.maxEdges ?? 52;
    const maxEdges = minEdges + Math.floor(Math.random() * (maxEdgesCap - minEdges + 1));
    const to = { i: si + heading.di, j: sj + heading.dj };

    this.signals.push({
      kind: 'wander',
      from: { i: si, j: sj },
      to,
      heading: { ...heading },
      progress: 0,
      edgesTraversed: 0,
      maxEdges,
      accent: 0,
      depth: 0,
      trail: [{ i: si, j: sj }],
      usedEdges: new Set([edgeKey(si, sj, to.i, to.j)]),
    });
  }

  _pickNextHeading(signal) {
    const at = signal.to;
    const back = { di: -signal.heading.di, dj: -signal.heading.dj };
    const forward = signal.heading;
    const turns = NEIGHBOURS.filter(
      (n) => !(n.di === forward.di && n.dj === forward.dj)
        && !(n.di === back.di && n.dj === back.dj)
    );

    const usable = (n) => {
      const ni = at.i + n.di;
      const nj = at.j + n.dj;
      return !signal.usedEdges.has(edgeKey(at.i, at.j, ni, nj));
    };

    const forwardOk = usable(forward);
    const turnOptions = turns.filter(usable);
    const forwardBias = Theme.signal.forwardBias ?? 0.78;

    if (forwardOk && turnOptions.length) {
      if (Math.random() < forwardBias) return forward;
      return turnOptions[Math.floor(Math.random() * turnOptions.length)];
    }
    if (forwardOk) return forward;
    if (turnOptions.length) {
      return turnOptions[Math.floor(Math.random() * turnOptions.length)];
    }

    // Soft reset instead of dying mid-grid — clear memory and continue.
    if (signal.usedEdges.size > 8) {
      signal.usedEdges.clear();
      if (usable(forward)) return forward;
      if (turnOptions.length) {
        return turnOptions[Math.floor(Math.random() * turnOptions.length)];
      }
      // Allow reverse as last resort so the pulse never pops off.
      return back;
    }
    return null;
  }

  _markResidual(i1, j1, i2, j2) {
    const key = edgeKey(i1, j1, i2, j2);
    const deposit = Theme.signal.residualDeposit ?? 0.42;
    const max = Theme.signal.residualMax ?? 0.5;
    const existing = this._residuals.get(key);
    if (existing) {
      existing.strength = Math.min(max, existing.strength + deposit);
      existing.touchedAt = this.timeMs;
      existing.dying = false;
      return;
    }

    const cap = Theme.signal.residualMaxEdges ?? 160;
    if (this._residuals.size >= cap) {
      // Drop the weakest mark instead of growing forever.
      let weakestKey = null;
      let weakest = Infinity;
      for (const [k, v] of this._residuals) {
        if (v.strength < weakest) {
          weakest = v.strength;
          weakestKey = k;
        }
      }
      if (weakestKey) this._residuals.delete(weakestKey);
    }

    this._residuals.set(key, {
      i1, j1, i2, j2,
      strength: Math.min(max, deposit),
      touchedAt: this.timeMs,
      dying: false,
    });
  }

  _decayResiduals(dt) {
    if (!this._residuals.size) return;
    const holdMs = Theme.signal.residualHoldMs ?? 12000;
    const liveHalf = Theme.signal.residualHalfLifeMs ?? 42000;
    const dieHalf = Theme.signal.residualDieHalfLifeMs ?? 28000;
    const minDraw = Theme.signal.residualMinDraw ?? 0.03;

    for (const [key, edge] of this._residuals) {
      const age = this.timeMs - (edge.touchedAt ?? 0);
      if (age < holdMs) continue; // linger at strength after last pass

      if (!edge.dying) edge.dying = true;
      // Once dying, ease out on the slower curve.
      const half = edge.strength > 0.18 ? liveHalf : dieHalf;
      edge.strength *= Math.pow(0.5, dt / half);
      if (edge.strength < minDraw) this._residuals.delete(key);
    }
  }

  _beginSignalDie(s) {
    if (s.dying) return;
    s.dying = true;
    s.dieMs = 0;
    s.dieDuration = Theme.signal.dieDurationMs ?? 1400;
    // Seal the edge it was on so the remnant stays.
    this._markResidual(s.from.i, s.from.j, s.to.i, s.to.j);
  }

  _updateDyingSignal(s, dt, trailCap) {
    s.dieMs = (s.dieMs ?? 0) + dt;
    const dur = s.dieDuration || 1400;
    const t = Math.min(1, s.dieMs / dur);
    // Ease trail away from the tail; head softens.
    s.accent = (s.accent ?? 0) * (1 - t);
    const keep = Math.max(1, Math.ceil((trailCap + 2) * (1 - t)));
    while (s.trail.length > keep) s.trail.shift();
    // Freeze progress so the head doesn't keep marching.
    s.progress = Math.min(s.progress, 0.98);
    return t < 1;
  }

  _buildResiduals() {
    const out = this._drawResiduals;
    out.length = 0;
    for (const edge of this._residuals.values()) {
      const a = latticeToWorld(edge.i1, edge.j1);
      const b = latticeToWorld(edge.i2, edge.j2);
      out.push({
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        strength: edge.strength,
      });
    }
    return out;
  }

  _updateSignals(dt) {
    const next = [];
    const spawned = [];
    const trailCap = Theme.signal.trailLengthEdges;

    for (const s of this.signals) {
      if (s.dying) {
        if (this._updateDyingSignal(s, dt, trailCap)) next.push(s);
        continue;
      }

      s.progress += PROGRESS_PER_MS * dt;

      if (s.kind === 'escort') {
        while (s.progress >= 1) {
          s.progress -= 1;
          this._markResidual(s.from.i, s.from.j, s.to.i, s.to.j);
          s.trail.push({ ...s.to });
          if (s.trail.length > trailCap + 2) s.trail.shift();

          // Junction: maybe fork before continuing the scripted path.
          this._maybeBranch(s, s.to, spawned);

          s.edgeIndex++;
          if (s.edgeIndex >= s.path.length - 1) {
            // Scripted approach done — keep traveling.
            const prev = s.from;
            s.from = { ...s.to };
            const hi = s.to.i - prev.i;
            const hj = s.to.j - prev.j;
            s.heading = {
              di: hi !== 0 ? Math.sign(hi) : 0,
              dj: hj !== 0 ? Math.sign(hj) : 0,
            };
            if (s.heading.di === 0 && s.heading.dj === 0) {
              s.heading = NEIGHBOURS[Math.floor(Math.random() * NEIGHBOURS.length)];
            }
            this._promoteEscortToWander(s);
            const pick = this._pickNextHeading(s);
            if (!pick) {
              this._beginSignalDie(s);
              break;
            }
            s.to = { i: s.from.i + pick.di, j: s.from.j + pick.dj };
            s.heading = { ...pick };
            s.usedEdges.add(edgeKey(s.from.i, s.from.j, s.to.i, s.to.j));
            break;
          }

          const prevFrom = s.from;
          s.from = { ...s.to };
          s.to = { ...s.path[s.edgeIndex + 1] };
          s.heading = {
            di: Math.sign(s.to.i - s.from.i) || Math.sign(s.from.i - prevFrom.i),
            dj: Math.sign(s.to.j - s.from.j) || Math.sign(s.from.j - prevFrom.j),
          };
          s.usedEdges.add(edgeKey(s.from.i, s.from.j, s.to.i, s.to.j));
        }
        if (s.dying) {
          next.push(s);
          continue;
        }
        if (s.progress < 0) continue;
        s.accent = 1;
        next.push(s);
        continue;
      }

      // Wander (including promoted escorts + branches)
      if (s.progress >= 1) {
        this._markResidual(s.from.i, s.from.j, s.to.i, s.to.j);
        s.edgesTraversed++;
        if (s.edgesTraversed >= s.maxEdges) {
          this._beginSignalDie(s);
          next.push(s);
          continue;
        }

        // Junction: occasional side branch(es).
        this._maybeBranch(s, s.to, spawned);

        const pick = this._pickNextHeading(s);
        if (!pick) {
          this._beginSignalDie(s);
          next.push(s);
          continue;
        }

        s.trail.push({ ...s.to });
        if (s.trail.length > trailCap + 2) s.trail.shift();
        s.from = { ...s.to };
        s.to = { i: s.to.i + pick.di, j: s.to.j + pick.dj };
        s.heading = { ...pick };
        s.usedEdges.add(edgeKey(s.from.i, s.from.j, s.to.i, s.to.j));
        s.progress -= 1;
      }
      s.accent = this._accentFor(s);
      next.push(s);
    }
    this.signals = next.concat(spawned);
  }

  _buildSurfaces() {
    const out = this._drawSurfaces;
    out.length = 0;
    for (const p of this.platforms) {
      if (p.phase === CELL.WAITING || p.phase === CELL.DONE) continue;
      const animScale = easeInOutCubic(p.surfaceProgress);
      const extrusionScale = easeInOutCubic(p.extrusionProgress);
      if (animScale <= 0.001 && extrusionScale <= 0.001) continue;
      out.push({
        corners: p.corners,
        center: p.center,
        animScale,
        extrusionScale,
        heightPx: p.heightPx,
      });
    }
    out.sort((a, b) => {
      const dy = a.center.y - b.center.y;
      return dy !== 0 ? dy : a.center.x - b.center.x;
    });
    return out;
  }

  _buildSignalGeometry() {
    const out = this._drawSignals;
    out.length = 0;
    const maxLen = Theme.signal.trailLengthEdges * EDGE;

    for (const s of this.signals) {
      const from = latticeToWorld(s.from.i, s.from.j);
      const to = latticeToWorld(s.to.i, s.to.j);
      const t = easeInOutQuad(Math.min(1, s.progress));
      const head = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };

      const pts = s.trail.map((n) => latticeToWorld(n.i, n.j));
      pts.push(head);

      const trimmed = trimFromHead(pts, maxLen);
      if (trimmed.length < 2) continue;

      let total = 0;
      for (let i = 1; i < trimmed.length; i++) {
        total += Math.hypot(trimmed[i].x - trimmed[i - 1].x, trimmed[i].y - trimmed[i - 1].y);
      }
      if (total <= 0) continue;

      const segments = [];
      let walked = 0;
      for (let i = 0; i < trimmed.length - 1; i++) {
        const a = trimmed[i];
        const b = trimmed[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len <= 0) continue;
        segments.push({
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          uStart: walked / total,
          uEnd: (walked + len) / total,
        });
        walked += len;
      }
      out.push({ segments, accent: s.accent ?? 1 });
    }
    return out;
  }
}

function edgeKey(i1, j1, i2, j2) {
  const a = `${i1},${j1}`;
  const b = `${i2},${j2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function trimFromHead(points, maxLen) {
  if (points.length < 2) return points;
  const head = points[points.length - 1];
  const result = [head];
  let acc = 0;
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 0) continue;
    if (acc + seg >= maxLen) {
      const remain = maxLen - acc;
      const t = 1 - remain / seg;
      result.unshift({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      return result;
    }
    acc += seg;
    result.unshift(a);
  }
  return result;
}

/**
 * theme.js — visual + timing constants for the scripted build.
 */

export const Theme = {
  color: {
    background: '#FAFAF8',
    gridLine: '#E3E5E8',
    node: '#BEC4CB',
    futureSurface: '#F3F4F5',
    futureLeftFace: '#E7E8EA',
    futureRightFace: '#D9DDE0',
    accent: '#ED0C32',
  },

  grid: {
    isoAngleDegrees: 28,
    spacing: 80,
    lineWidth: 1,
    nodeSize: 3,
    overscanFactor: 1.05,
    depthBands: 6,
  },

  depth: {
    fadeBandHeight: 0.72,
    minOpacity: 0.05,
    maxOpacity: 1.0,
    minScale: 0.72,
  },

  signal: {
    speedWorldPerSec: 145,
    headColor: '#ED0C32',
    bodyColorStart: '#D4626F',
    bodyColorEnd: '#E08A93',
    tailColor: '#D0D3D7',
    lineWidth: 2,
    headOpacity: 0.92,
    bodyOpacity: 0.7,
    tailOpacity: 0.38,
    subdivs: 2,

    /**
     * Escort pulses: one line per cluster. Approaches the block, optionally
     * loops one hero cell, then keeps wandering (no abrupt die-off).
     */
    escortMaxConcurrent: 5,
    escortLeadMs: 180,
    approachEdgesMin: 5,
    approachEdgesMax: 9,
    // Chance to draw one perimeter on the hero cell before continuing.
    perimeterChance: 0.55,
    continueMinEdges: 28,
    continueMaxEdges: 52,
    // After the cluster pass, accent red fades out over this many edges.
    accentFadeEdges: 10,

    /**
     * Soft etch left on lattice edges after a pulse passes.
     * Slow decay so paths linger, capped so it stays subtle.
     */
    residualDeposit: 0.55,
    residualMax: 0.72,
    residualHalfLifeMs: 42000,
    // Stay near full strength this long after last touch, then start dying.
    residualHoldMs: 12000,
    // Final fade is slower so remnants ease out instead of dropping off.
    residualDieHalfLifeMs: 28000,
    residualMinDraw: 0.03,
    residualMaxEdges: 220,
    residualLineWidth: 1.45,
    // Slightly darker than gridLine — readable but quiet.
    residualColor: '#B0B5BC',

    // When a pulse finishes traveling, fade the live trail into remnants.
    dieDurationMs: 1400,

    /**
     * Occasional side branches off a traveling pulse.
     * Cheap: just spawn short wanderers at a junction.
     */
    branchChance: 0.21,
    branchChanceOnBranch: 0.075,
    branchCountMax: 2,
    branchMinEdges: 8,
    branchMaxEdges: 24,
    branchMaxDepth: 2,
    // Hard cap across escorts + wanderers + branches.
    maxSignalsTotal: 18,

    trailLengthEdges: 16,
    maxConcurrent: 5,
    forwardBias: 0.78,
    turnBias: 0.22,
    // Legacy free-roam spawner (escorts already continue as wander).
    wanderEnabled: false,
    minEdges: 20,
    maxEdges: 36,
  },

  surface: {
    // Slower ease so rise/fall feel gradual, not snappy.
    animDurationMs: 1400,
    extrusionDurationMs: 1100,
  },

  /**
   * Continuous overlapping waves (no bake / no p5 teardown).
   * Cells rise/hold/fall on independent clocks; new waves keep arriving
   * so some regions go up while others go down.
   */
  lifecycle: {
    waveHorizonMs: 10000,
    waveGapMinMs: 2400,
    waveGapMaxMs: 4600,
    maxActiveCells: 36,
  },

  performance: {
    targetFps: 30,
    drawLatticeNodes: false,
  },
};

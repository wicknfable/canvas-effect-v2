/**
 * grid.js — isometric lattice generation + cell corner helpers.
 */

import { Theme } from './theme.js';

const angleRad = (Theme.grid.isoAngleDegrees * Math.PI) / 180;
const spacing = Theme.grid.spacing;
const basisU = { x: Math.cos(angleRad) * spacing, y: Math.sin(angleRad) * spacing };
const basisV = { x: -Math.cos(angleRad) * spacing, y: Math.sin(angleRad) * spacing };

let _latticeCache = null;

export function latticeToWorld(i, j) {
  return {
    x: i * basisU.x + j * basisV.x,
    y: i * basisU.y + j * basisV.y,
  };
}

function worldToLattice(worldX, worldY) {
  const det = basisU.x * basisV.y - basisV.x * basisU.y;
  return {
    i: (worldX * basisV.y - worldY * basisV.x) / det,
    j: (worldY * basisU.x - worldX * basisU.y) / det,
  };
}

export function latticeEdgeKey(i1, j1, i2, j2) {
  const a = `${i1},${j1}`;
  const b = `${i2},${j2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Diamond corners of cell (ci,cj): top, right, bottom, left. */
export function cellWorldCorners(ci, cj) {
  return [
    latticeToWorld(ci, cj),
    latticeToWorld(ci + 1, cj),
    latticeToWorld(ci + 1, cj + 1),
    latticeToWorld(ci, cj + 1),
  ];
}

export function cellWorldCenter(corners) {
  return {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) * 0.25,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) * 0.25,
  };
}

export function generateLatticeData(worldBounds) {
  const corners = [
    worldToLattice(worldBounds.minX, worldBounds.minY),
    worldToLattice(worldBounds.maxX, worldBounds.minY),
    worldToLattice(worldBounds.minX, worldBounds.maxY),
    worldToLattice(worldBounds.maxX, worldBounds.maxY),
  ];

  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (const c of corners) {
    minI = Math.min(minI, c.i);
    maxI = Math.max(maxI, c.i);
    minJ = Math.min(minJ, c.j);
    maxJ = Math.max(maxJ, c.j);
  }
  minI = Math.floor(minI) - 1;
  maxI = Math.ceil(maxI) + 1;
  minJ = Math.floor(minJ) - 1;
  maxJ = Math.ceil(maxJ) + 1;

  const cacheKey = `${minI},${maxI},${minJ},${maxJ}`;
  if (_latticeCache && _latticeCache.key === cacheKey) {
    return _latticeCache.data;
  }

  const nodes = [];
  const positionLookup = new Map();

  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) {
      const p = latticeToWorld(i, j);
      positionLookup.set(`${i},${j}`, p);
      nodes.push({ i, j, x: p.x, y: p.y });
    }
  }

  const edges = [];
  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) {
      const here = positionLookup.get(`${i},${j}`);
      const right = positionLookup.get(`${i + 1},${j}`);
      if (right) {
        edges.push({
          x1: here.x, y1: here.y, x2: right.x, y2: right.y,
          key: latticeEdgeKey(i, j, i + 1, j),
        });
      }
      const down = positionLookup.get(`${i},${j + 1}`);
      if (down) {
        edges.push({
          x1: here.x, y1: here.y, x2: down.x, y2: down.y,
          key: latticeEdgeKey(i, j, i, j + 1),
        });
      }
    }
  }

  const data = { nodes, edges };
  _latticeCache = { key: cacheKey, data };
  return data;
}

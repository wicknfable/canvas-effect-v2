/**
 * renderer.js — lattice bake + extrusions + decorative signals.
 */

import { Theme } from './theme.js';

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return [
    parseInt(v.substring(0, 2), 16),
    parseInt(v.substring(2, 4), 16),
    parseInt(v.substring(4, 6), 16),
  ];
}

function easeSmooth(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function depthFactor(screenY, vh) {
  const band = vh * Theme.depth.fadeBandHeight;
  if (band <= 0) return 1;
  return easeSmooth(screenY / band);
}

function opacityFor(d) {
  return Theme.depth.minOpacity + (Theme.depth.maxOpacity - Theme.depth.minOpacity) * d;
}

function scaleFor(d) {
  return Theme.depth.minScale + (1 - Theme.depth.minScale) * d;
}

function lerpRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function pulseColorAt(u, head, bodyStart, bodyEnd, tail) {
  const { headOpacity, bodyOpacity, tailOpacity } = Theme.signal;
  if (u >= 0.72) {
    const t = (u - 0.72) / 0.28;
    const desat = lerpRgb(head, bodyStart, 0.15);
    return [...lerpRgb(desat, head, t), bodyOpacity + (headOpacity - bodyOpacity) * t];
  }
  if (u >= 0.28) {
    const t = (u - 0.28) / 0.44;
    return [...lerpRgb(bodyStart, bodyEnd, t), tailOpacity + (bodyOpacity - tailOpacity) * t];
  }
  const t = u / 0.28;
  const grey = lerpRgb(tail, bodyEnd, t * 0.4);
  return [...lerpRgb(bodyEnd, grey, 1 - t), tailOpacity * t];
}

export class Renderer {
  constructor(p) {
    this.p = p;
    this.bg = hexToRgb(Theme.color.background);
    this.gridRgb = hexToRgb(Theme.color.gridLine);
    this.surfaceRgb = hexToRgb(Theme.color.futureSurface);
    this.leftRgb = hexToRgb(Theme.color.futureLeftFace);
    this.rightRgb = hexToRgb(Theme.color.futureRightFace);
    this.headRgb = hexToRgb(Theme.signal.headColor);
    this.bodyStartRgb = hexToRgb(Theme.signal.bodyColorStart);
    this.bodyEndRgb = hexToRgb(Theme.signal.bodyColorEnd);
    this.tailRgb = hexToRgb(Theme.signal.tailColor);
    this.residualRgb = hexToRgb(Theme.signal.residualColor || Theme.color.gridLine);

    this._latticeGfx = null;
    this._latticeKey = '';
    this._bandStyles = null;
    this._fp = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ];
    this._top = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ];
  }

  _hideGfx(g) {
    const el = g.elt || g.canvas;
    if (!el) return;
    el.classList.add('attention-offscreen');
    el.style.cssText = 'position:absolute;left:-99999px;width:1px;height:1px;opacity:0;visibility:hidden;pointer-events:none';
  }

  clearTransparent() {
    this.p.clear();
  }

  bakeLatticeDataUrl(screenLattice) {
    const w = this.p.width;
    const h = this.p.height;
    this._ensureLattice(screenLattice, w, h);

    const baked = this.p.createGraphics(w, h);
    baked.pixelDensity(1);
    this._hideGfx(baked);
    baked.background(...this.bg);
    baked.image(this._latticeGfx, 0, 0);
    const url = baked.canvas.toDataURL('image/png');
    baked.remove();
    return url;
  }

  bakeFinalDataUrl(screenLattice, camera, drawData) {
    const w = this.p.width;
    const h = this.p.height;
    this._ensureLattice(screenLattice, w, h);

    const baked = this.p.createGraphics(w, h);
    baked.pixelDensity(1);
    this._hideGfx(baked);
    baked.background(...this.bg);
    baked.image(this._latticeGfx, 0, 0);

    const main = this.p;
    this.p = baked;
    this.drawDynamic(camera, drawData, { skipSignals: true });
    this.p = main;

    const url = baked.canvas.toDataURL('image/png');
    baked.remove();
    return url;
  }

  _ensureLattice(screenLattice, w, h) {
    const key = `${w}x${h}|${screenLattice.edges.length}`;
    if (this._latticeGfx && this._latticeKey === key) return;

    if (!this._latticeGfx || this._latticeGfx.width !== w || this._latticeGfx.height !== h) {
      this._latticeGfx = this.p.createGraphics(w, h);
      this._latticeGfx.pixelDensity(1);
      this._hideGfx(this._latticeGfx);
    }

    const g = this._latticeGfx;
    g.clear();
    const bandCount = screenLattice.bandCount || 6;
    this._ensureBands(bandCount);

    const buckets = Array.from({ length: bandCount }, () => []);
    for (const e of screenLattice.edges) buckets[e.band].push(e);

    const [r, gc, b] = this.gridRgb;
    g.noFill();
    for (let band = 0; band < bandCount; band++) {
      const list = buckets[band];
      if (!list.length) continue;
      const style = this._bandStyles[band];
      g.stroke(r, gc, b, style.alpha);
      g.strokeWeight(style.weight);
      for (const e of list) g.line(e.x1, e.y1, e.x2, e.y2);
    }
    this._latticeKey = key;
  }

  _ensureBands(n) {
    if (this._bandStyles && this._bandStyles.length === n) return;
    this._bandStyles = [];
    for (let i = 0; i < n; i++) {
      const d = (i + 0.5) / n;
      this._bandStyles.push({
        alpha: opacityFor(d) * 255,
        weight: Theme.grid.lineWidth * scaleFor(d),
      });
    }
  }

  drawDynamic(camera, drawData, opts = {}) {
    // Residuals under pulses; extrusions on top.
    this._drawResiduals(drawData.residuals, camera);
    if (!opts.skipSignals) {
      this._drawSignals(drawData.signals, camera);
    }
    this._drawSurfaces(drawData.surfaces, camera);
  }

  _drawResiduals(residuals, camera) {
    if (!residuals || !residuals.length) return;
    const p = this.p;
    const vh = camera.viewportHeight;
    const [rr, rg, rb] = this.residualRgb;
    const weight = Theme.signal.residualLineWidth ?? 1.2;
    p.noFill();

    for (const edge of residuals) {
      const from = camera.worldToScreen(edge.x1, edge.y1);
      const to = camera.worldToScreen(edge.x2, edge.y2);
      const midY = (from.y + to.y) * 0.5;
      const d = depthFactor(midY, vh);
      const alpha = edge.strength * opacityFor(d) * 255;
      if (alpha < 2) continue;
      p.stroke(rr, rg, rb, alpha);
      p.strokeWeight(weight * scaleFor(d));
      p.line(from.x, from.y, to.x, to.y);
    }
  }

  _drawSurfaces(surfaces, camera) {
    const p = this.p;
    const [sr, sg, sb] = this.surfaceRgb;
    const [lr, lg, lb] = this.leftRgb;
    const [rr, rg, rb] = this.rightRgb;
    const fp = this._fp;
    const top = this._top;

    p.noStroke();
    for (const surface of surfaces) {
      const baseCenter = camera.worldToScreen(surface.center.x, surface.center.y);
      const s = surface.animScale;
      for (let i = 0; i < 4; i++) {
        const sc = camera.worldToScreen(surface.corners[i].x, surface.corners[i].y);
        fp[i].x = baseCenter.x + (sc.x - baseCenter.x) * s;
        fp[i].y = baseCenter.y + (sc.y - baseCenter.y) * s;
      }
      const extrude = surface.heightPx * surface.extrusionScale;
      for (let i = 0; i < 4; i++) {
        top[i].x = fp[i].x;
        top[i].y = fp[i].y - extrude;
      }

      if (surface.animScale > 0) {
        p.fill(sr, sg, sb, 255);
        p.beginShape();
        for (let i = 0; i < 4; i++) p.vertex(fp[i].x, fp[i].y);
        p.endShape(p.CLOSE);
      }

      if (surface.extrusionScale > 0) {
        p.fill(lr, lg, lb, 255);
        p.beginShape();
        p.vertex(fp[3].x, fp[3].y);
        p.vertex(fp[2].x, fp[2].y);
        p.vertex(top[2].x, top[2].y);
        p.vertex(top[3].x, top[3].y);
        p.endShape(p.CLOSE);

        p.fill(rr, rg, rb, 255);
        p.beginShape();
        p.vertex(fp[1].x, fp[1].y);
        p.vertex(fp[2].x, fp[2].y);
        p.vertex(top[2].x, top[2].y);
        p.vertex(top[1].x, top[1].y);
        p.endShape(p.CLOSE);

        p.fill(sr, sg, sb, 255);
        p.beginShape();
        for (let i = 0; i < 4; i++) p.vertex(top[i].x, top[i].y);
        p.endShape(p.CLOSE);
      }
    }
  }

  _drawSignals(signals, camera) {
    const p = this.p;
    const subdivs = Theme.signal.subdivs ?? 2;
    const vh = camera.viewportHeight;
    const grid = this.gridRgb;
    p.noFill();

    for (const signal of signals) {
      const accent = signal.accent ?? 1;
      for (const seg of signal.segments) {
        const from = camera.worldToScreen(seg.x1, seg.y1);
        const to = camera.worldToScreen(seg.x2, seg.y2);
        const midY = (from.y + to.y) * 0.5;
        const d = depthFactor(midY, vh);
        const depthA = opacityFor(d);
        p.strokeWeight(Theme.signal.lineWidth * scaleFor(d));

        for (let i = 0; i < subdivs; i++) {
          const t0 = i / subdivs;
          const t1 = (i + 1) / subdivs;
          const u = seg.uStart + (seg.uEnd - seg.uStart) * (t0 + t1) * 0.5;
          const x0 = from.x + (to.x - from.x) * t0;
          const y0 = from.y + (to.y - from.y) * t0;
          const x1 = from.x + (to.x - from.x) * t1;
          const y1 = from.y + (to.y - from.y) * t1;
          const [pr, pg, pb, pa] = pulseColorAt(
            u, this.headRgb, this.bodyStartRgb, this.bodyEndRgb, this.tailRgb
          );
          // After the cluster pass, bleed accent into grid grey.
          const r = pr + (grid[0] - pr) * (1 - accent);
          const g = pg + (grid[1] - pg) * (1 - accent);
          const b = pb + (grid[2] - pb) * (1 - accent);
          const a = pa * (0.35 + 0.65 * accent);
          const alpha = a * depthA * 255;
          if (alpha < 1) continue;
          p.stroke(r, g, b, alpha);
          p.line(x0, y0, x1, y1);
        }
      }
    }
  }
}

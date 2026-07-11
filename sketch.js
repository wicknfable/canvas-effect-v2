/**
 * sketch.js — continuous scripted Attention RWA backdrop.
 *
 * Lifecycle:
 *   1. Bake lattice → CSS backdrop (static grid only)
 *   2. Keep p5 running: scripted waves + cluster escort pulses that keep traveling
 *
 * Edit generation in script.js / timing in theme.js.
 */

import { Theme } from './theme.js';
import { Camera } from './camera.js';
import { generateLatticeData } from './grid.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';

export function createAttentionSketch(container) {
  const host = resolveContainer(container);
  ensureHostStyle(host);

  const sketch = (p) => {
    let camera;
    let renderer;
    let player;
    let pageVisible = !document.hidden;
    let resizeObserver = null;
    let screenLattice = null;

    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (pageVisible) p.loop();
      else p.noLoop();
    };

    function rebuildScreenLattice() {
      const bounds = camera.getVisibleWorldBounds(Theme.grid.overscanFactor);
      const latticeData = generateLatticeData(bounds);
      screenLattice = projectLatticeToScreen(latticeData, camera);
      applyBackdrop(host, renderer.bakeLatticeDataUrl(screenLattice));
    }

    function applyHostSize(w, h) {
      p.resizeCanvas(w, h);
      camera.x = w * 0.10;
      camera.y = h * -0.05;
      camera.resize(w, h);
      rebuildScreenLattice();
    }

    p.setup = () => {
      p.pixelDensity(1);
      const { width, height } = measureHost(host);
      const canvas = p.createCanvas(width, height);
      canvas.parent(host);

      if (canvas.elt) {
        Object.assign(canvas.elt.style, {
          pointerEvents: 'none',
          display: 'block',
          background: 'transparent',
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          zIndex: '0',
        });
        canvas.elt.setAttribute('aria-hidden', 'true');
      }

      camera = new Camera(width * 0.10, height * -0.05, 1);
      renderer = new Renderer(p);
      player = new Player();
      camera.resize(width, height);
      rebuildScreenLattice();
      p.frameRate(Theme.performance?.targetFps ?? 30);

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          const size = measureHost(host);
          if (size.width === p.width && size.height === p.height) return;
          applyHostSize(size.width, size.height);
        });
        resizeObserver.observe(host);
      }

      document.addEventListener('visibilitychange', onVisibilityChange);
    };

    p.draw = () => {
      if (!pageVisible) return;
      if (!screenLattice) rebuildScreenLattice();

      player.update(p.deltaTime);
      renderer.clearTransparent();
      renderer.drawDynamic(camera, player.getDrawData());
    };

    p.windowResized = () => {
      const size = measureHost(host);
      applyHostSize(size.width, size.height);
    };
  };

  return new p5(sketch, host);
}

function applyBackdrop(host, dataUrl) {
  let layer = host.querySelector('[data-attention-backdrop]');
  if (!layer) {
    layer = document.createElement('div');
    layer.setAttribute('data-attention-backdrop', '');
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '0',
      pointerEvents: 'none',
      backgroundSize: '100% 100%',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
    host.insertBefore(layer, host.firstChild);
  }
  layer.style.backgroundImage = `url(${dataUrl})`;
  layer.style.backgroundColor = Theme.color.background;
}

function ensureHostStyle(host) {
  host.setAttribute('data-attention-rwa', '');
  host.style.pointerEvents = 'none';
  const computed = getComputedStyle(host);
  if (computed.position === 'static') host.style.position = 'relative';
}

function projectLatticeToScreen(latticeData, camera) {
  const vh = camera.viewportHeight;
  const fadeBandPx = Math.max(1, vh * Theme.depth.fadeBandHeight);
  const bandCount = Theme.grid.depthBands || 6;
  const edges = [];

  for (const edge of latticeData.edges) {
    const a = camera.worldToScreen(edge.x1, edge.y1);
    const b = camera.worldToScreen(edge.x2, edge.y2);
    const midY = (a.y + b.y) * 0.5;
    const t = Math.min(1, Math.max(0, midY / fadeBandPx));
    const depth = t * t * (3 - 2 * t);
    const band = Math.min(bandCount - 1, Math.floor(depth * bandCount));
    edges.push({
      key: edge.key,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      band,
    });
  }

  return { edges, nodes: [], bandCount };
}

function resolveContainer(container) {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') {
    const el = document.querySelector(container);
    if (el) return el;
  }
  return (
    document.getElementById('canvas-container') ||
    document.querySelector('[data-attention-rwa]') ||
    document.body
  );
}

function measureHost(host) {
  const rect = host.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(rect.width || host.clientWidth || window.innerWidth)),
    height: Math.max(1, Math.floor(rect.height || host.clientHeight || window.innerHeight)),
  };
}

createAttentionSketch();

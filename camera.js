/**
 * camera.js — world ↔ screen for a fixed isometric view.
 */

export class Camera {
  constructor(x = 0, y = 0, zoom = 1) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this._bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  worldToScreen(worldX, worldY) {
    return {
      x: this.viewportWidth * 0.5 + (worldX - this.x) * this.zoom,
      y: this.viewportHeight * 0.5 + (worldY - this.y) * this.zoom,
    };
  }

  getVisibleWorldBounds(overscanFactor = 1) {
    const halfW = (this.viewportWidth * 0.5) / this.zoom * overscanFactor;
    const halfH = (this.viewportHeight * 0.5) / this.zoom * overscanFactor;
    const b = this._bounds;
    b.minX = this.x - halfW;
    b.maxX = this.x + halfW;
    b.minY = this.y - halfH;
    b.maxY = this.y + halfH;
    return b;
  }
}

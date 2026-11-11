// Draw an Artwork with any Canvas2D implementation (the browser's, or
// @napi-rs/canvas in tests). Images must already be decoded: the caller
// passes a lookup from asset key to a drawable.
import type { Artwork, Layer, PaintLayer } from "./schema";

/** The Canvas2D surface we need (DOM and @napi-rs/canvas both fit). */
export type Ctx = CanvasRenderingContext2D;

export interface ArtEnv {
  /** An empty w x h canvas (for paint layers with an eraser). */
  canvas(w: number, h: number): { getContext(id: "2d"): Ctx | null } & CanvasImageSource;
  /** Decoded image for an asset key, or null if not loaded. */
  image(asset: string): CanvasImageSource | null;
}

export function renderArt(art: Artwork, ctx: Ctx, w: number, h: number, env: ArtEnv): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = art.background;
  ctx.fillRect(0, 0, w, h);
  for (const l of art.layers) if (l.visible) drawLayer(l, ctx, w, h, env);
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawLayer(l: Layer, ctx: Ctx, w: number, h: number, env: ArtEnv): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
  switch (l.type) {
    case "image": {
      const img = env.image(l.asset);
      if (img) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, l.x, l.y, l.w, l.h);
      }
      break;
    }
    case "rect": {
      roundRect(ctx, l.x, l.y, l.w, l.h, l.radius);
      if (l.fill) {
        if (l.gradient) {
          const g = l.gradient.dir === "v"
            ? ctx.createLinearGradient(0, l.y, 0, l.y + l.h)
            : ctx.createLinearGradient(l.x, 0, l.x + l.w, 0);
          g.addColorStop(0, l.fill);
          g.addColorStop(1, l.gradient.to);
          ctx.fillStyle = g;
        } else ctx.fillStyle = l.fill;
        ctx.fill();
      }
      if (l.stroke && l.strokeWidth > 0) {
        // keep the stroke inside the box, like most editors' "inner" border
        const s = l.strokeWidth;
        roundRect(ctx, l.x + s / 2, l.y + s / 2, l.w - s, l.h - s, Math.max(0, l.radius - s / 2));
        ctx.strokeStyle = l.stroke;
        ctx.lineWidth = s;
        ctx.stroke();
      }
      break;
    }
    case "ellipse": {
      const s = l.stroke ? l.strokeWidth : 0;
      ctx.beginPath();
      ctx.ellipse(l.x + l.w / 2, l.y + l.h / 2, Math.max(0, l.w / 2 - s / 2), Math.max(0, l.h / 2 - s / 2), 0, 0, Math.PI * 2);
      if (l.fill) {
        ctx.fillStyle = l.fill;
        ctx.fill();
      }
      if (l.stroke && s > 0) {
        ctx.strokeStyle = l.stroke;
        ctx.lineWidth = s;
        ctx.stroke();
      }
      break;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width;
      ctx.lineCap = "round";
      ctx.stroke();
      break;
    case "text": {
      ctx.fillStyle = l.color;
      ctx.font = `${l.bold ? "bold " : ""}${l.size}px ${quoteFamily(l.font)}`;
      ctx.textBaseline = "top";
      ctx.textAlign = l.align;
      l.text.split("\n").forEach((line, i) => ctx.fillText(line, l.x, l.y + i * l.size * 1.2));
      break;
    }
    case "paint":
      drawPaint(l, ctx, w, h, env);
      break;
  }
  ctx.restore();
}

function quoteFamily(f: string): string {
  return /^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/.test(f) ? f : `"${f.replace(/"/g, "")}"`;
}

function strokePath(ctx: Ctx, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  if (pts.length === 2) ctx.lineTo(pts[0]! + 0.01, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
}

function drawPaint(l: PaintLayer, ctx: Ctx, w: number, h: number, env: ArtEnv): void {
  // strokes go on their own canvas so the eraser only removes paint
  const off = env.canvas(w, h);
  const o = off.getContext("2d");
  if (!o) return;
  o.lineCap = "round";
  o.lineJoin = "round";
  for (const s of l.strokes) {
    if (s.points.length < 2) continue;
    o.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    o.strokeStyle = s.erase ? "#000" : s.color;
    o.lineWidth = s.width;
    strokePath(o, s.points);
    o.stroke();
  }
  ctx.drawImage(off, 0, 0);
}

/** A drawable from 24-bit BMP bytes (works with any env canvas). */
export function bmpSource(env: ArtEnv, data: Uint8Array, load: (data: Uint8Array) => { w: number; h: number; toRGBA(): Uint8ClampedArray }): CanvasImageSource {
  const bm = load(data);
  const c = env.canvas(bm.w, bm.h);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(bm.w, bm.h);
  img.data.set(bm.toRGBA());
  ctx.putImageData(img, 0, 0);
  return c;
}

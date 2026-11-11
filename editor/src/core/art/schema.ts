// Page artwork: the editable source of a page picture. It is flattened to
// the page's 24-bit BMP whenever it changes; the BMP is what the screen
// gets. Binary sources (images, fonts) are assets under "art/".

export type Color = string; // "#rrggbb"

interface Base {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
}

export interface ImageLayer extends Base {
  type: "image";
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Resize keeping the aspect ratio (default true when absent). */
  keepAspect?: boolean;
  /** Natural width / height of the source image. */
  ratio?: number;
}

export interface Gradient {
  to: Color;
  dir: "v" | "h";
}

export interface RectLayer extends Base {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  fill: Color | null;
  gradient: Gradient | null;
  stroke: Color | null;
  strokeWidth: number;
}

export interface EllipseLayer extends Base {
  type: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: Color | null;
  stroke: Color | null;
  strokeWidth: number;
}

export interface LineLayer extends Base {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: Color;
  width: number;
}

export interface TextLayer extends Base {
  type: "text";
  x: number;
  y: number;
  text: string;
  font: string; // CSS family: a system family or an uploaded font's family
  size: number;
  bold: boolean;
  color: Color;
  align: "left" | "center" | "right";
}

export interface Stroke {
  points: number[]; // x0, y0, x1, y1, ...
  color: Color;
  width: number;
  erase: boolean;
}

export interface PaintLayer extends Base {
  type: "paint";
  strokes: Stroke[];
}

export type Layer = ImageLayer | RectLayer | EllipseLayer | LineLayer | TextLayer | PaintLayer;
export type LayerType = Layer["type"];

export interface Artwork {
  /** Bottom to top. */
  layers: Layer[];
  /** Colour under all layers. */
  background: Color;
  /** Ordered dithering to RGB565 when flattening (smooths gradients). */
  dither: boolean;
}

/** A font uploaded for text layers. */
export interface ArtFont {
  family: string;
  asset: string;
}

export const SYSTEM_FONTS = ["sans-serif", "serif", "monospace"];

let n = 0;
export function layerId(): string {
  n = (n + 1) % 0x10000;
  return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + n.toString(36);
}

const base = (name: string): Base => ({ id: layerId(), name, visible: true, locked: false, opacity: 1 });

export function newLayer(type: LayerType, at: { x: number; y: number; w?: number; h?: number } = { x: 40, y: 40 }): Layer {
  const { x, y } = at;
  const w = at.w ?? 120, h = at.h ?? 60;
  switch (type) {
    case "rect":
      return { ...base("Rectangle"), type, x, y, w, h, radius: 6, fill: "#2f6fde", gradient: null, stroke: null, strokeWidth: 2 };
    case "ellipse":
      return { ...base("Ellipse"), type, x, y, w, h, fill: "#ff8a1f", stroke: null, strokeWidth: 2 };
    case "line":
      return { ...base("Line"), type, x1: x, y1: y, x2: x + w, y2: y + h, color: "#ffffff", width: 2 };
    case "text":
      return { ...base("Text"), type, x, y, text: "Text", font: "sans-serif", size: 24, bold: false, color: "#ffffff", align: "left" };
    case "paint":
      return { ...base("Paint"), type, strokes: [] };
    case "image":
      return { ...base("Image"), type, asset: "", x, y, w, h, keepAspect: true };
  }
}

export type Box = [x: number, y: number, w: number, h: number];

/** Layer bounds as (x, y, w, h); paint layers cover their strokes. */
export function layerBox(l: Layer): Box | null {
  switch (l.type) {
    case "image": case "rect": case "ellipse":
      return [l.x, l.y, l.w, l.h];
    case "line": {
      const pad = Math.ceil(l.width / 2);
      return [Math.min(l.x1, l.x2) - pad, Math.min(l.y1, l.y2) - pad, Math.abs(l.x2 - l.x1) + 2 * pad, Math.abs(l.y2 - l.y1) + 2 * pad];
    }
    case "text": {
      // estimate (fonts are measured by the renderer); good enough for picking
      const lines = l.text.split("\n");
      const w = Math.max(...lines.map((s) => s.length)) * l.size * 0.55;
      const x = l.align === "center" ? l.x - w / 2 : l.align === "right" ? l.x - w : l.x;
      return [x, l.y, w, lines.length * l.size * 1.2];
    }
    case "paint": {
      const pts = l.strokes.flatMap((s) => s.points);
      if (!pts.length) return null;
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      const pad = Math.max(...l.strokes.map((s) => s.width)) / 2;
      return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad];
    }
  }
}

export function moveLayer(l: Layer, dx: number, dy: number): Layer {
  switch (l.type) {
    case "line":
      return { ...l, x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy };
    case "paint":
      return { ...l, strokes: l.strokes.map((s) => ({ ...s, points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) })) };
    default:
      return { ...l, x: l.x + dx, y: l.y + dy };
  }
}

/** Layers whose box can be dragged by its edges. */
export function hasBox(l: Layer): l is ImageLayer | RectLayer | EllipseLayer {
  return l.type === "image" || l.type === "rect" || l.type === "ellipse";
}

export function setLayerBox(l: Layer, b: Box): Layer {
  if (!hasBox(l)) return l;
  let [x, y, w, h] = b;
  if (w < 0) [x, w] = [x + w, -w];
  if (h < 0) [y, h] = [y + h, -h];
  return { ...l, x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** Asset keys an artwork uses. */
export function artAssets(a: Artwork): string[] {
  return a.layers.flatMap((l) => (l.type === "image" && l.asset ? [l.asset] : []));
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Aspect ratio an image layer keeps when resized, or null if free. */
export function lockedRatio(l: Layer): number | null {
  if (l.type !== "image" || l.keepAspect === false) return null;
  return l.ratio && l.ratio > 0 ? l.ratio : l.h > 0 ? l.w / l.h : null;
}

/** Box after dragging `handle` of `orig` by (dx, dy); with `ratio`, the
 * box keeps width / height = ratio: corners scale from the opposite
 * corner, edges resize and stay centred on the other axis. */
export function resizeBox(orig: Box, handle: ResizeHandle, dx: number, dy: number, ratio: number | null = null): Box {
  const [ox, oy, ow, oh] = orig;
  let x = ox, y = oy, w = ow, h = oh;
  if (handle.includes("w")) { x += dx; w -= dx; }
  if (handle.includes("e")) w += dx;
  if (handle.includes("n")) { y += dy; h -= dy; }
  if (handle.includes("s")) h += dy;
  if (!ratio) return [x, y, w, h];
  w = Math.max(1, w);
  h = Math.max(1, h);
  const corner = handle.length === 2;
  if (corner) {
    // follow whichever side moved more, relative to its size
    if (Math.abs(w / ow - 1) >= Math.abs(h / oh - 1)) h = w / ratio;
    else w = h * ratio;
    x = handle.includes("w") ? ox + ow - w : ox;
    y = handle.includes("n") ? oy + oh - h : oy;
  } else if (handle === "e" || handle === "w") {
    h = w / ratio;
    y = oy + (oh - h) / 2;
  } else {
    w = h * ratio;
    x = ox + (ow - w) / 2;
  }
  return [x, y, w, h];
}

// Rasterising a font into DWIN's ASCII library layout (every even height
// 8..128, cells h/2 wide, 1 bit per pixel) with any Canvas2D.
import { ASCII_HEIGHTS, AsciiFontLib, type Glyph } from "../formats/hzk";
import type { Ctx } from "../art/render";

export interface RasterOptions {
  family: string;
  bold: boolean;
  /** Glyph size relative to the cell height (1 = font em fills the cell). */
  scale: number;
  /** Shift in pixels at height 16 (scaled with the height). */
  dx: number;
  dy: number;
  /** Alpha 0..255 above which a pixel is set. */
  threshold: number;
}

export const DEFAULT_RASTER: Omit<RasterOptions, "family"> = { bold: false, scale: 0.95, dx: 0, dy: 0, threshold: 110 };

export type CanvasFactory = (w: number, h: number) => { getContext(id: "2d"): Ctx | null };

function quote(f: string) {
  return /^(sans-serif|serif|monospace)$/.test(f) ? f : `"${f.replace(/"/g, "")}"`;
}

/** Draw one character into an h/2 x h cell. */
export function rasterGlyph(make: CanvasFactory, h: number, code: number, o: RasterOptions): Glyph {
  const w = h / 2;
  const c = make(w, h);
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const size = Math.max(1, h * o.scale);
  ctx.font = `${o.bold ? "bold " : ""}${size}px ${quote(o.family)}`;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  const ch = String.fromCharCode(code);
  const m = ctx.measureText(ch);
  // squeeze wide glyphs into the cell
  const sx = m.width > w ? w / m.width : 1;
  // put the baseline so ascent + descent of the font are centred in the cell
  const fm = ctx.measureText("Hgjy|");
  const asc = fm.fontBoundingBoxAscent || size * 0.8, desc = fm.fontBoundingBoxDescent || size * 0.2;
  const k = h / 16;
  const base = (h - (asc + desc)) / 2 + asc + o.dy * k;
  ctx.save();
  ctx.translate(w / 2 + o.dx * k, base);
  ctx.scale(sx, 1);
  ctx.fillText(ch, 0, 0);
  ctx.restore();
  const data = ctx.getImageData(0, 0, w, h).data;
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3]! > o.threshold ? 1 : 0;
  return { w, h, bits };
}

export interface GenerateOptions extends RasterOptions {
  heights?: number[];
  codes?: number[];
  /** Called after each height, for progress. Return false to stop. */
  progress?: (done: number, total: number) => boolean | void;
}

export const PRINTABLE: number[] = Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i);

/** Rasterise the chosen heights and codes into `lib` (other glyphs stay). */
export function generateAscii(lib: AsciiFontLib, make: CanvasFactory, o: GenerateOptions): AsciiFontLib {
  const heights = o.heights ?? [...ASCII_HEIGHTS];
  const codes = o.codes ?? PRINTABLE;
  heights.forEach((h, i) => {
    for (const code of codes) lib.setGlyph(h, code, rasterGlyph(make, h, code, o));
    if (o.progress?.(i + 1, heights.length) === false) throw new Error("cancelled");
  });
  return lib;
}

// DWIN 1-bpp font libraries.
//
// 0_DWIN_ASC.HZK (font id 0, factory ASCII library), worked out from the
// DGUS-reloaded copy and the guide ("all ASCII characters from 4*8 to
// 64*128"): for every even height h = 8, 10, ..., 128 (w = h / 2) it holds
// 128 glyphs (codes 0x00-0x7F) of ceil(w / 8) * h bytes, rows top to bottom,
// MSB = leftmost pixel. The total is exactly 3 082 752 bytes.
import { FormatError } from "../bytes";

export const ASCII_HEIGHTS: readonly number[] = Array.from({ length: 61 }, (_, i) => 8 + i * 2);
export const ASCII_GLYPHS = 128;

export function glyphBytes(w: number, h: number): number {
  return Math.ceil(w / 8) * h;
}

function asciiLayout(): Map<number, number> {
  const m = new Map<number, number>();
  let off = 0;
  for (const h of ASCII_HEIGHTS) {
    m.set(h, off);
    off += ASCII_GLYPHS * glyphBytes(h / 2, h);
  }
  m.set(-1, off); // total size
  return m;
}
const LAYOUT = asciiLayout();
export const ASCII_LIB_SIZE = LAYOUT.get(-1)!;

/** A glyph as one byte per pixel (0/1), row-major. */
export interface Glyph {
  w: number;
  h: number;
  bits: Uint8Array;
}

export function unpackGlyph(data: Uint8Array, off: number, w: number, h: number): Glyph {
  const stride = Math.ceil(w / 8);
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = data[off + y * stride + (x >> 3)]!;
      bits[y * w + x] = (b >> (7 - (x & 7))) & 1;
    }
  }
  return { w, h, bits };
}

export function packGlyph(g: Glyph, out: Uint8Array, off: number): void {
  const stride = Math.ceil(g.w / 8);
  out.fill(0, off, off + stride * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.bits[y * g.w + x]) out[off + y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
}

/** The multi-size ASCII library, as raw bytes with glyph accessors. */
export class AsciiFontLib {
  data: Uint8Array;

  constructor(data?: Uint8Array) {
    this.data = data ? data.slice() : new Uint8Array(ASCII_LIB_SIZE);
    if (this.data.length !== ASCII_LIB_SIZE) {
      throw new FormatError(`ASCII font library must be ${ASCII_LIB_SIZE} bytes`);
    }
  }

  static parse(data: Uint8Array): AsciiFontLib {
    return new AsciiFontLib(data);
  }

  build(): Uint8Array {
    return this.data.slice();
  }

  private offset(h: number, code: number): number {
    const base = LAYOUT.get(h);
    if (base === undefined || h < 0) throw new FormatError(`no ASCII font of height ${h}`);
    if (code < 0 || code >= ASCII_GLYPHS) throw new FormatError(`code 0x${code.toString(16)} out of range`);
    return base + code * glyphBytes(h / 2, h);
  }

  glyph(h: number, code: number): Glyph {
    return unpackGlyph(this.data, this.offset(h, code), h / 2, h);
  }

  setGlyph(h: number, code: number, g: Glyph): void {
    if (g.w !== h / 2 || g.h !== h) throw new FormatError(`glyph must be ${h / 2}x${h}`);
    packGlyph(g, this.data, this.offset(h, code));
  }
}

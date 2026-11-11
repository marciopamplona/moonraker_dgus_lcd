// 24-bit BMP read/write (port of screen_files.py Bitmap). Pixels are kept as
// top-to-bottom RGB rows. save() writes the same bytes as the Python helper.
import { FormatError } from "../bytes";

export class Bitmap {
  readonly w: number;
  readonly h: number;
  px: Uint8Array; // RGB, rows top to bottom

  constructor(w: number, h: number, px?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.px = px ? px.slice() : new Uint8Array(w * h * 3);
    if (this.px.length !== w * h * 3) throw new FormatError("pixel buffer size mismatch");
  }

  static load(data: Uint8Array): Bitmap {
    if (data[0] !== 0x42 || data[1] !== 0x4d) throw new FormatError("not a BMP");
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const off = dv.getUint32(10, true);
    const w = dv.getInt32(18, true);
    let h = dv.getInt32(22, true);
    const bpp = dv.getUint16(28, true);
    const comp = dv.getUint32(30, true);
    if (bpp !== 24 || comp !== 0) throw new FormatError("only 24-bit uncompressed BMP supported");
    const topDown = h < 0;
    h = Math.abs(h);
    const stride = (w * 3 + 3) & ~3;
    if (off + stride * (h - 1) + w * 3 > data.length) throw new FormatError("truncated BMP");
    const bm = new Bitmap(w, h);
    for (let y = 0; y < h; y++) {
      const src = off + (topDown ? y : h - 1 - y) * stride;
      const dst = y * w * 3;
      for (let x = 0; x < w; x++) {
        const s = src + x * 3;
        const d = dst + x * 3;
        bm.px[d] = data[s + 2]!;
        bm.px[d + 1] = data[s + 1]!;
        bm.px[d + 2] = data[s]!;
      }
    }
    return bm;
  }

  save(): Uint8Array {
    const stride = (this.w * 3 + 3) & ~3;
    const size = stride * this.h;
    const out = new Uint8Array(54 + size);
    const dv = new DataView(out.buffer);
    out[0] = 0x42;
    out[1] = 0x4d;
    dv.setUint32(2, 54 + size, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, this.w, true);
    dv.setInt32(22, this.h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, size, true);
    dv.setInt32(38, 2835, true);
    dv.setInt32(42, 2835, true);
    for (let y = 0; y < this.h; y++) {
      const dst = 54 + (this.h - 1 - y) * stride;
      const src = y * this.w * 3;
      for (let x = 0; x < this.w; x++) {
        const s = src + x * 3;
        const d = dst + x * 3;
        out[d] = this.px[s + 2]!;
        out[d + 1] = this.px[s + 1]!;
        out[d + 2] = this.px[s]!;
      }
    }
    return out;
  }

  copy(): Bitmap {
    return new Bitmap(this.w, this.h, this.px);
  }

  get(x: number, y: number): [number, number, number] {
    const i = (y * this.w + x) * 3;
    return [this.px[i]!, this.px[i + 1]!, this.px[i + 2]!];
  }

  set(x: number, y: number, rgb: readonly [number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(rgb, (y * this.w + x) * 3);
  }

  /** RGBA for canvas ImageData. */
  toRGBA(): Uint8ClampedArray<ArrayBuffer> {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0, j = 0; i < this.px.length; i += 3, j += 4) {
      out[j] = this.px[i]!;
      out[j + 1] = this.px[i + 1]!;
      out[j + 2] = this.px[i + 2]!;
      out[j + 3] = 255;
    }
    return out;
  }

  /** From canvas ImageData RGBA (alpha is dropped). */
  static fromRGBA(w: number, h: number, rgba: ArrayLike<number>): Bitmap {
    const bm = new Bitmap(w, h);
    for (let i = 0, j = 0; j < bm.px.length; i += 4, j += 3) {
      bm.px[j] = rgba[i]!;
      bm.px[j + 1] = rgba[i + 1]!;
      bm.px[j + 2] = rgba[i + 2]!;
    }
    return bm;
  }
}

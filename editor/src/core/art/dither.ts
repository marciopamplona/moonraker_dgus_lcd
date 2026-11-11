// RGB565 quantisation of RGBA pixel buffers, with optional ordered (Bayer
// 4x4) dithering so gradients don't band on the screen.

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** In place: each channel snapped to the 5/6/5-bit level the screen shows,
 * replicated back to 8 bits. */
export function quantize565(px: Uint8ClampedArray | Uint8Array, w: number, h: number, dither: boolean): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = dither ? BAYER4[(y & 3) * 4 + (x & 3)]! / 16 - 0.5 : 0;
      for (let c = 0; c < 3; c++) {
        const bits = c === 1 ? 6 : 5;
        const max = (1 << bits) - 1;
        const v = Math.max(0, Math.min(max, Math.round((px[i + c]! / 255) * max + t)));
        px[i + c] = (v << (8 - bits)) | (v >> (2 * bits - 8));
      }
    }
  }
}

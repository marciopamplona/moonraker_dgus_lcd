// RGB565 as the DWIN tools produce it: plain truncation of 8-bit channels
// (verified pixel-exact against DGUS-reloaded's .ico files and source BMPs).

export function to565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

/** 565 -> 8-bit channels, replicating high bits into the low ones. */
export function from565(v: number): [number, number, number] {
  const r = (v >> 11) & 0x1f;
  const g = (v >> 5) & 0x3f;
  const b = v & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** What a 24-bit colour will look like on the screen. */
export function quantize(r: number, g: number, b: number): [number, number, number] {
  return from565(to565(r, g, b));
}

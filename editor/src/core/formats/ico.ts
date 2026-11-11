// DWIN .ICO icon library (T5UID1), reverse-engineered from DGUS-reloaded's
// 24/27/30/37_*.ico against their source BMP folders (pixel-exact):
//
//   0x00000  index: 32768 entries x 8 bytes, entry n = icon id n
//              w(1) h(1) addr(4, big-endian, in 16-bit words from file start)
//              reserved(2) = 0; all-zero entry = no icon
//   0x40000  pixel data, RGB565 big-endian, row-major, no padding
//
// The DWIN tool stores icon data in the order of the source file names
// sorted as strings ("0, 1, 10, 11, ..., 2"); the index stays by id. The
// order is kept so rebuilt files are byte-identical.
import { FormatError, put16, put32, u16, u32, u8 } from "../bytes";
import { Bitmap } from "./bmp";
import { from565, to565 } from "./rgb565";

export const ICO_INDEX_SIZE = 0x40000;
export const ICO_MAX_ICONS = ICO_INDEX_SIZE / 8;
export const ICO_MAX_SIDE = 255;

export interface Icon {
  w: number;
  h: number;
  pixels: Uint16Array; // RGB565, row-major
}

export class IconLibrary {
  icons: Map<number, Icon>;
  /** Icon ids in data order (see header comment). */
  order: number[];

  constructor(icons: Map<number, Icon> = new Map(), order?: number[]) {
    this.icons = icons;
    this.order = order ?? defaultOrder([...icons.keys()]);
  }

  static parse(data: Uint8Array): IconLibrary {
    if (data.length < ICO_INDEX_SIZE) throw new FormatError("ICO file too short");
    const icons = new Map<number, Icon>();
    const addrs: [number, number][] = [];
    for (let id = 0; id < ICO_MAX_ICONS; id++) {
      const i = id * 8;
      const w = u8(data, i);
      const h = u8(data, i + 1);
      const addr = u32(data, i + 2);
      if (!w && !h && !addr) continue;
      const off = addr * 2;
      if (!w || !h || off < ICO_INDEX_SIZE || off + w * h * 2 > data.length) {
        throw new FormatError(`bad index entry for icon ${id}`);
      }
      const pixels = new Uint16Array(w * h);
      for (let p = 0; p < pixels.length; p++) pixels[p] = u16(data, off + p * 2);
      icons.set(id, { w, h, pixels });
      addrs.push([addr, id]);
    }
    addrs.sort((a, b) => a[0] - b[0]);
    return new IconLibrary(icons, addrs.map(([, id]) => id));
  }

  build(): Uint8Array {
    const order = this.dataOrder();
    let size = ICO_INDEX_SIZE;
    for (const id of order) {
      const ic = this.icons.get(id)!;
      size += ic.w * ic.h * 2;
    }
    const out = new Uint8Array(size);
    let off = ICO_INDEX_SIZE;
    for (const id of order) {
      const ic = this.icons.get(id)!;
      if (id < 0 || id >= ICO_MAX_ICONS) throw new FormatError(`icon id ${id} out of range`);
      if (ic.w < 1 || ic.h < 1 || ic.w > ICO_MAX_SIDE || ic.h > ICO_MAX_SIDE) {
        throw new FormatError(`icon ${id}: size ${ic.w}x${ic.h} not supported (1..${ICO_MAX_SIDE})`);
      }
      if (ic.pixels.length !== ic.w * ic.h) throw new FormatError(`icon ${id}: pixel count mismatch`);
      out[id * 8] = ic.w;
      out[id * 8 + 1] = ic.h;
      put32(out, id * 8 + 2, off / 2);
      for (let p = 0; p < ic.pixels.length; p++) put16(out, off + p * 2, ic.pixels[p]!);
      off += ic.pixels.length * 2;
    }
    return out;
  }

  /** `order` restricted to existing icons, followed by any new ones. */
  dataOrder(): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of this.order) {
      if (this.icons.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    const rest = [...this.icons.keys()].filter((id) => !seen.has(id));
    return out.concat(defaultOrder(rest));
  }

  set(id: number, icon: Icon): void {
    this.icons.set(id, icon);
  }

  delete(id: number): void {
    this.icons.delete(id);
  }
}

/** Ids sorted as strings, like the DWIN tool's file name order. */
export function defaultOrder(ids: number[]): number[] {
  return [...ids].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}

export function iconFromBitmap(bm: Bitmap): Icon {
  const pixels = new Uint16Array(bm.w * bm.h);
  for (let p = 0; p < pixels.length; p++) {
    pixels[p] = to565(bm.px[p * 3]!, bm.px[p * 3 + 1]!, bm.px[p * 3 + 2]!);
  }
  return { w: bm.w, h: bm.h, pixels };
}

export function iconToBitmap(ic: Icon): Bitmap {
  const bm = new Bitmap(ic.w, ic.h);
  for (let p = 0; p < ic.pixels.length; p++) bm.px.set(from565(ic.pixels[p]!), p * 3);
  return bm;
}

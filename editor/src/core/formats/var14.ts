// 14*.BIN: display variables, "DGUS_2" indexed layout (Development Guide
// V4.3, ch. 8). Port of dgus_lcd/screen_files.py VariableFile.
//   0x00   header (16 bytes: 0x14 'DGUS_2' ...; max page id at 0x08)
//   0x10   index, 4 bytes per page: count(1) + byte offset(3)
//   0x4000 32-byte display variable entries, grouped by page
//   ...    trailer (kept verbatim)
import { FormatError, concat, put16, put24, u16, u24, u8 } from "../bytes";

export const INDEX_OFF = 0x10;
export const DATA_OFF = 0x4000;
export const VAR_SIZE = 32;
export const MAX_PAGES = (DATA_OFF - INDEX_OFF) / 4;
const MAGIC = "DGUS_2";

export const VAR_NAMES: Readonly<Record<number, string>> = {
  0x00: "Variable icon",
  0x01: "Animated icon",
  0x02: "Slider display",
  0x03: "Artistic number",
  0x04: "Image animation",
  0x05: "Icon rotation",
  0x06: "Bit icon",
  0x07: "Icon translation",
  0x10: "Data variable",
  0x11: "Text",
  0x12: "RTC",
  0x13: "HEX data",
  0x14: "Scrolling text",
  0x20: "Trend curve",
  0x21: "Basic graphics",
  0x22: "Area fill",
  0x23: "Rect / table",
  0x24: "Area scroll",
  0x25: "Data window",
  0x26: "Picture cut",
};

export class VariableFile {
  header: Uint8Array;
  pages: Map<number, Uint8Array[]>;
  trailer: Uint8Array;

  constructor(header: Uint8Array, pages: Map<number, Uint8Array[]>, trailer = new Uint8Array(0)) {
    this.header = header.slice();
    this.pages = new Map([...pages].filter(([, v]) => v.length));
    this.trailer = trailer;
  }

  /** An empty file with the header layout DGUS-reloaded uses. */
  static empty(): VariableFile {
    const h = new Uint8Array(INDEX_OFF);
    h[0] = 0x14;
    h.set(new TextEncoder().encode(MAGIC), 1);
    h[7] = 0x10;
    return new VariableFile(h, new Map());
  }

  static parse(data: Uint8Array): VariableFile {
    if (new TextDecoder().decode(data.subarray(1, 7)) !== MAGIC) {
      throw new FormatError("not a DGUS_2 variable file");
    }
    const pages = new Map<number, Uint8Array[]>();
    let usedEnd = DATA_OFF;
    for (let page = 0; page < MAX_PAGES; page++) {
      const i = INDEX_OFF + page * 4;
      const count = u8(data, i);
      const off = u24(data, i + 1);
      if (!count) continue;
      const end = off + count * VAR_SIZE;
      if (off < DATA_OFF || end > data.length) {
        throw new FormatError(`bad index for page ${page}`);
      }
      const list: Uint8Array[] = [];
      for (let k = 0; k < count; k++) {
        list.push(data.slice(off + k * VAR_SIZE, off + (k + 1) * VAR_SIZE));
      }
      pages.set(page, list);
      usedEnd = Math.max(usedEnd, end);
    }
    return new VariableFile(data.subarray(0, INDEX_OFF), pages, data.slice(usedEnd));
  }

  build(): Uint8Array {
    const index = new Uint8Array(DATA_OFF - INDEX_OFF);
    const body: Uint8Array[] = [];
    let off = DATA_OFF;
    for (let page = 0; page < MAX_PAGES; page++) {
      const entries = this.pages.get(page) ?? [];
      if (entries.length > 255) {
        throw new FormatError(`too many variables on page ${page}`);
      }
      index[page * 4] = entries.length;
      put24(index, page * 4 + 1, off);
      for (const e of entries) {
        if (e.length !== VAR_SIZE) throw new FormatError("variable entry must be 32 bytes");
        body.push(e);
      }
      off += entries.length * VAR_SIZE;
    }
    const header = this.header.slice();
    const top = this.pages.size ? Math.max(...this.pages.keys()) : 0;
    if (u16(header, 8) < top) put16(header, 8, top);
    return concat([header, index, ...body, this.trailer]);
  }

  add(page: number, entry: Uint8Array): void {
    const list = this.pages.get(page);
    if (list) list.push(entry);
    else this.pages.set(page, [entry]);
  }
}

/** Display variable type (byte 1 after the 0x5A marker), or null. */
export function varType(e: Uint8Array): number | null {
  return e[0] === 0x5a ? (e[1] ?? null) : null;
}

export interface TextVar {
  vp: number;
  pos: [number, number];
  color: number;
  box: [number, number, number, number];
  length: number;
  size: number;
}

/** A text (0x11) display variable, laid out like DGUS-reloaded's. */
export function textVar(
  vp: number, x: number, y: number, box: [number, number, number, number], length: number,
  { size = 20, color = 0xb5b6, encode = 0x02, font0 = 0, font1 = 0 } = {},
): Uint8Array {
  const e = new Uint8Array(VAR_SIZE);
  e[0] = 0x5a;
  e[1] = 0x11;
  put16(e, 2, 0xffff);
  put16(e, 4, 0x000d);
  [vp, x, y, color, ...box, length].forEach((v, i) => put16(e, 6 + i * 2, v));
  e.set([font0, font1, size, size, encode], 24);
  return e;
}

export function parseTextVar(e: Uint8Array): TextVar | null {
  if (varType(e) !== 0x11) return null;
  const w = (i: number) => u16(e, 6 + i * 2);
  return {
    vp: w(0), pos: [w(1), w(2)], color: w(3),
    box: [w(4), w(5), w(6), w(7)], length: w(8), size: u8(e, 27),
  };
}

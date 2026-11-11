// 13*.BIN: touch configuration (DGUS Development Guide V4.3, ch. 7).
// Port of dgus_lcd/screen_files.py TouchFile; entries are kept as raw bytes
// so parse -> build is byte-identical, with typed views on top.
//
// Entry layout (big-endian):
//   0  flags(1) page(1)      flags 0x08 = click sound (guide: Pic_ID, 2 bytes)
//   2  Xs Ys Xe Ye (2 each)
//   10 Pic_Next(2) Pic_On(2) 0xFF.. = none
//   14 TP_Code(2)            0xFE../0xFD.. function, else a plain key code
//   16 function data         size depends on the function
// The file ends with FF FF.
import { FormatError, concat, put16, u16, u8 } from "../bytes";

export const FLAG_SOUND = 0x08;

/** Total entry size per function code. */
export const TOUCH_SIZES: Readonly<Record<number, number>> = {
  0x00: 64, // variable data input
  0x01: 48, // popup menu
  0x02: 32, // incremental adjustment
  0x03: 32, // slider adjustment
  0x04: 48, // RTC setting            (guide; not seen in DGUS-reloaded)
  0x05: 32, // return key code
  0x06: 64, // text input             (guide)
  0x07: 32, // firmware parameter     (guide)
  0x08: 48, // return press state     (guide)
  0x09: 48, // rotational adjustment  (guide; padded to 16)
};
export const PLAIN_KEY_SIZE = 16;

export const TOUCH_NAMES: Readonly<Record<number, string>> = {
  0x00: "Data input",
  0x01: "Popup menu",
  0x02: "Incremental adjust",
  0x03: "Slider",
  0x04: "RTC setting",
  0x05: "Return key code",
  0x06: "Text input",
  0x07: "Firmware parameter",
  0x08: "Press state",
  0x09: "Rotary adjust",
};

export type Rect = [xs: number, ys: number, xe: number, ye: number];

export interface TouchHead {
  flags: number;
  page: number;
  area: Rect;
  picNext: number; // 0xFF.. = none
  picOn: number; // 0xFF.. = none
  code: number; // TP_Code
}

export function isFunctionCode(code: number): boolean {
  const hi = code >> 8;
  return hi === 0xfe || hi === 0xfd;
}

export function entrySize(head: Uint8Array): number {
  const code = u16(head, 14);
  if (!isFunctionCode(code)) return PLAIN_KEY_SIZE;
  const size = TOUCH_SIZES[code & 0xff];
  if (size === undefined) {
    throw new FormatError(`unknown touch function 0x${code.toString(16)}`);
  }
  return size;
}

export function readHead(e: Uint8Array): TouchHead {
  return {
    flags: u8(e, 0),
    page: u8(e, 1),
    area: [u16(e, 2), u16(e, 4), u16(e, 6), u16(e, 8)],
    picNext: u16(e, 10),
    picOn: u16(e, 12),
    code: u16(e, 14),
  };
}

/** Copy of `e` with the 16-byte head replaced. */
export function writeHead(e: Uint8Array, h: TouchHead): Uint8Array {
  const out = e.slice();
  out[0] = h.flags;
  out[1] = h.page;
  h.area.forEach((v, i) => put16(out, 2 + i * 2, v));
  put16(out, 10, h.picNext);
  put16(out, 12, h.picOn);
  put16(out, 14, h.code);
  return out;
}

export class TouchFile {
  entries: Uint8Array[];

  constructor(entries: Iterable<Uint8Array> = []) {
    this.entries = [...entries];
  }

  static parse(data: Uint8Array): TouchFile {
    const entries: Uint8Array[] = [];
    let i = 0;
    for (;;) {
      if (data[i] === 0xff && data[i + 1] === 0xff) {
        if (i + 2 !== data.length) {
          throw new FormatError(`data after terminator at 0x${i.toString(16)}`);
        }
        return new TouchFile(entries);
      }
      if (i + 16 > data.length) {
        throw new FormatError(`truncated entry at 0x${i.toString(16)}`);
      }
      const size = entrySize(data.subarray(i, i + 16));
      if (i + size > data.length) {
        throw new FormatError(`truncated entry at 0x${i.toString(16)}`);
      }
      entries.push(data.slice(i, i + size));
      i += size;
    }
  }

  build(): Uint8Array {
    return concat([...this.entries, new Uint8Array([0xff, 0xff])]);
  }

  static pageOf(e: Uint8Array): number {
    return u8(e, 1);
  }

  pages(): number[] {
    return [...new Set(this.entries.map(TouchFile.pageOf))].sort((a, b) => a - b);
  }

  forPage(page: number): Uint8Array[] {
    return this.entries.filter((e) => TouchFile.pageOf(e) === page);
  }

  /** Insert after the last entry of the same page (keeps grouping). */
  add(entry: Uint8Array): void {
    const page = TouchFile.pageOf(entry);
    let pos = this.entries.length;
    this.entries.forEach((e, i) => {
      if (TouchFile.pageOf(e) <= page) pos = i + 1;
    });
    this.entries.splice(pos, 0, entry);
  }

  removePage(page: number): void {
    this.entries = this.entries.filter((e) => TouchFile.pageOf(e) !== page);
  }
}

// --- typed helpers (same output as screen_files.py) ------------------------

function head(flags: number, page: number, area: Rect, code: number): Uint8Array {
  return writeHead(new Uint8Array(16), {
    flags, page, area, picNext: 0xff00, picOn: 0xff00, code,
  });
}

export interface ReturnKey {
  page: number;
  area: Rect;
  vp: number;
  mode: number; // 0x00 word, 0x01 high byte, 0x02 low byte, 0x10-0x1F bit
  key: number;
  sound: boolean;
}

/** A "return key code" (0x05) touch area writing `key` to `vp`. */
export function returnKey(
  page: number, area: Rect, vp: number, key: number,
  { sound = true, mode = 0x00, upload = true } = {},
): Uint8Array {
  const e = new Uint8Array(32);
  e.set(head(sound ? FLAG_SOUND : 0, page, area, upload ? 0xfe05 : 0xfd05));
  e[16] = 0xfe;
  put16(e, 17, vp);
  e[19] = mode;
  put16(e, 20, key);
  return e;
}

export function parseReturnKey(e: Uint8Array): ReturnKey | null {
  if (e.length !== 32 || e[15] !== 0x05) return null;
  const h = readHead(e);
  return {
    page: h.page, area: h.area, vp: u16(e, 17), mode: u8(e, 19),
    key: u16(e, 20), sound: (h.flags & FLAG_SOUND) !== 0,
  };
}

export interface DataInputOptions {
  vType?: number; // 0x00 int16, 0x01 int32
  nInt?: number;
  nDot?: number;
  limits?: [number, number] | null;
  sound?: boolean;
  keypad?: number;
  kbArea?: Rect;
  kbPos?: [number, number];
  cursor?: [number, number];
  color?: number;
  fontW?: number;
}

/** A "variable data input" (0x00) area popping up keypad page `keypad`.
 * Defaults are DGUS-reloaded's numpad (page 202). */
export function dataInput(page: number, area: Rect, vp: number, o: DataInputOptions = {}): Uint8Array {
  const {
    vType = 0x01, nInt = 5, nDot = 2, limits = [-9999999, 9999999], sound = true,
    keypad = 0xca, kbArea = [0x90, 0x32, 0x14f, 0xfc], kbPos = [0x90, 0x28],
    cursor = [0x142, 0x31], color = 0x1082, fontW = 0x0e,
  } = o;
  const e = new Uint8Array(64);
  const dv = new DataView(e.buffer);
  e.set(head(sound ? FLAG_SOUND : 0, page, area, 0xfe00));
  e[16] = 0xfe;
  put16(e, 17, vp);
  e[19] = vType;
  e[20] = nInt;
  e[21] = nDot;
  put16(e, 22, cursor[0]);
  put16(e, 24, cursor[1]);
  put16(e, 26, color);
  e[28] = 0x00;
  e[29] = fontW;
  e[30] = 0x00;
  e[31] = 0x01;
  e[32] = 0xfe;
  e[33] = 0x01;
  put16(e, 34, keypad);
  kbArea.forEach((v, i) => put16(e, 36 + i * 2, v));
  put16(e, 44, kbPos[0]);
  put16(e, 46, kbPos[1]);
  e[48] = 0xfe;
  e[49] = limits ? 0xff : 0x00;
  const [lo, hi] = limits ?? [0, 0];
  dv.setInt32(50, lo);
  dv.setInt32(54, hi);
  return e;
}

// New controls. Header words (SP, length) follow DGUS-reloaded's files;
// test/m2.test.ts checks them against the vendored entries.
import { put16 } from "../bytes";
import { FLAG_SOUND, dataInput, returnKey, writeHead, type Rect } from "../formats/touch13";
import { textVar } from "../formats/var14";
import type { Kind } from "./geometry";

export interface Template {
  id: string;
  kind: Kind;
  label: string;
  hint: string;
  size: [number, number];
  /** VP words to allocate (0 = no VP). */
  words: number;
  make: (page: number, x: number, y: number, vp: number) => Uint8Array;
}

const area = (x: number, y: number, w: number, h: number): Rect => [x, y, x + w - 1, y + h - 1];

function touch(size: number, page: number, a: Rect, code: number): Uint8Array {
  return writeHead(new Uint8Array(size), {
    flags: FLAG_SOUND, page, area: a, picNext: 0xff00, picOn: 0xff00, code,
  });
}

function display(type: number, words: number, vp: number, x: number, y: number): Uint8Array {
  const e = new Uint8Array(32);
  e[0] = 0x5a;
  e[1] = type;
  put16(e, 2, 0xffff);
  put16(e, 4, words);
  put16(e, 6, vp);
  put16(e, 8, x);
  put16(e, 10, y);
  return e;
}

export const TEMPLATES: Template[] = [
  {
    id: "button", kind: "touch", label: "Button / page jump", size: [100, 40], words: 0,
    hint: "Touch area with a click sound; set Pic_Next to switch pages.",
    make: (page, x, y) => touch(16, page, area(x, y, 100, 40), 0xff00),
  },
  {
    id: "return-key", kind: "touch", label: "Return key code", size: [100, 40], words: 1,
    hint: "Writes a key code to a VP (and reports it to the host).",
    make: (page, x, y, vp) => returnKey(page, area(x, y, 100, 40), vp, 0x0001),
  },
  {
    id: "data-input", kind: "touch", label: "Number input", size: [120, 32], words: 2,
    hint: "Pops up a keypad page and writes the number to a VP.",
    make: (page, x, y, vp) => dataInput(page, area(x, y, 120, 32), vp, { cursor: [x + 116, y + 6] }),
  },
  {
    id: "increment", kind: "touch", label: "+/- adjust", size: [40, 40], words: 1,
    hint: "Adds Step to a VP on each press, within V_Min..V_Max.",
    make: (page, x, y, vp) => {
      const e = touch(32, page, area(x, y, 40, 40), 0xfe02);
      e[16] = 0xfe;
      put16(e, 17, vp);
      e[20] = 0x01; // +
      put16(e, 22, 1);
      put16(e, 24, 0);
      put16(e, 26, 100);
      return e;
    },
  },
  {
    id: "slider", kind: "touch", label: "Slider (touch)", size: [200, 30], words: 1,
    hint: "Sliding across the area writes V_begin..V_end to a VP.",
    make: (page, x, y, vp) => {
      const a = area(x, y, 200, 30);
      const e = touch(32, page, a, 0xfe03);
      e[16] = 0xfe;
      put16(e, 17, vp);
      a.forEach((v, i) => put16(e, 20 + i * 2, v));
      put16(e, 30, 100);
      return e;
    },
  },
  {
    id: "text", kind: "display", label: "Text", size: [160, 24], words: 10,
    hint: "Shows the text stored at a VP (Text_length bytes).",
    make: (_p, x, y, vp) => textVar(vp, x, y, [x, y, x + 159, y + 23], 20, { size: 20, color: 0xffff, encode: 0 }),
  },
  {
    id: "number", kind: "display", label: "Number", size: [80, 24], words: 1,
    hint: "Shows the integer at a VP, with optional decimals and unit.",
    make: (_p, x, y, vp) => {
      const e = display(0x10, 0x000d, vp, x, y);
      put16(e, 12, 0xffff); // white
      e[14] = 0; // font 0
      e[15] = 12; // font width
      e[16] = 0x00; // left aligned (0 left, 1 right, 2 centred)
      e[17] = 5; // integer digits
      e[18] = 0; // decimals
      e[19] = 0x00; // int16
      return e;
    },
  },
  {
    id: "icon", kind: "display", label: "Variable icon", size: [32, 32], words: 1,
    hint: "Shows icon Icon_Min + (value - V_Min) from an icon library.",
    make: (_p, x, y, vp) => {
      const e = display(0x00, 0x0008, vp, x, y);
      put16(e, 12, 0);
      put16(e, 14, 1);
      put16(e, 16, 0);
      put16(e, 18, 1);
      return e;
    },
  },
  {
    id: "bit-icon", kind: "display", label: "Bit icon", size: [32, 32], words: 3,
    hint: "Shows ICON1S when the selected bits of the VP are set, else ICON0S.",
    make: (_p, x, y, vp) => {
      const e = new Uint8Array(32);
      e.set([0x5a, 0x06]);
      put16(e, 2, 0xffff);
      put16(e, 4, 0x000c);
      put16(e, 6, vp);
      put16(e, 8, vp + 1);
      put16(e, 10, 0x0001);
      put16(e, 16, 0);
      put16(e, 18, 0);
      put16(e, 20, 1);
      put16(e, 22, 1);
      put16(e, 24, x);
      put16(e, 26, y);
      return e;
    },
  },
];

export function template(id: string): Template {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown template ${id}`);
  return t;
}

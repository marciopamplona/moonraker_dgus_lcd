// A small model of the screen's behaviour, enough to click through a
// project in the browser: VP memory, touch actions, and what the display
// variables would show. Host behaviour (the printer service switching
// pages, filling VPs) is not simulated; the user edits VPs instead.
import { fromHex } from "../bytes";
import { describeTouch, describeVar, type ControlInfo } from "../controls/describe";
import type { HostRule, Page } from "../project/schema";
import { hostTarget } from "./host";

const field = (i: ControlInfo, name: string) => i.fields.find((f) => f.name === name)?.value ?? 0;

export type SimEvent =
  | { type: "write"; vp: number; value: number; words: number; source: string }
  | { type: "key"; code: number }
  | { type: "jump"; page: number; via?: "host" }
  | { type: "info"; text: string };

export interface InputRequest {
  kind: "number" | "text";
  vp: number;
  /** number: decimals, limits and word count; text: max bytes. */
  nDot: number;
  min: number | null;
  max: number | null;
  words: number;
  maxBytes: number;
  keypadPage: number | null;
}

export interface PressResult {
  events: SimEvent[];
  input: InputRequest | null;
}

export interface Drawn {
  uid: string;
  kind: "text" | "icon";
  x: number;
  y: number;
  text?: string;
  color?: number;
  size?: number;
  align?: "left" | "right" | "center";
  box?: [number, number, number, number];
  icon?: { lib: number; id: number; transparent: boolean };
}

export class Simulator {
  /** VP -> 16-bit word. */
  mem = new Map<number, number>();
  page: number;
  log: SimEvent[] = [];
  /** Host page-switch rules, and the pages that exist. */
  rules: HostRule[] = [];
  pages: Set<number> | null = null;

  constructor(page: number, rules: HostRule[] = [], pages?: Iterable<number>) {
    this.page = page;
    this.rules = rules;
    this.pages = pages ? new Set(pages) : null;
  }

  /** Apply host rules to a write; returns the events they cause. */
  private host(ev: SimEvent): SimEvent[] {
    if (ev.type !== "write") return [];
    const to = hostTarget(this.rules, ev.vp, this.read(ev.vp, 1, false));
    if (to === null) return [];
    if (this.pages && !this.pages.has(to)) return [{ type: "info", text: `host: page ${to} doesn't exist` }];
    this.page = to;
    return [{ type: "jump", page: to, via: "host" }];
  }

  get(vp: number): number {
    return this.mem.get(vp & 0xffff) ?? 0;
  }

  set(vp: number, v: number): void {
    this.mem.set(vp & 0xffff, v & 0xffff);
  }

  /** Signed or unsigned value of `words` words at vp (big-endian). */
  read(vp: number, words: number, signed: boolean): number {
    let v = 0n;
    for (let i = 0; i < words; i++) v = (v << 16n) | BigInt(this.get(vp + i));
    const bits = BigInt(words * 16);
    if (signed && v >> (bits - 1n)) v -= 1n << bits;
    return Number(v);
  }

  write(vp: number, words: number, value: number, source: string): SimEvent {
    let v = BigInt(Math.trunc(value));
    const bits = BigInt(words * 16);
    v &= (1n << bits) - 1n;
    for (let i = words - 1; i >= 0; i--) {
      this.set(vp + i, Number(v & 0xffffn));
      v >>= 16n;
    }
    const ev: SimEvent = { type: "write", vp, value, words, source };
    this.log.push(ev);
    return ev;
  }

  private writeMode(vp: number, mode: number, value: number, source: string): SimEvent {
    const old = this.get(vp);
    let v = value & 0xffff;
    if (mode === 0x01) v = (old & 0x00ff) | ((value & 0xff) << 8);
    else if (mode === 0x02) v = (old & 0xff00) | (value & 0xff);
    else if (mode >= 0x10 && mode <= 0x1f) {
      const bit = 1 << (mode - 0x10);
      v = value & 1 ? old | bit : old & ~bit;
    }
    return this.write(vp, 1, v, source);
  }

  private readMode(vp: number, mode: number): number {
    const w = this.get(vp);
    if (mode === 0x01) return w >> 8;
    if (mode === 0x02) return w & 0xff;
    if (mode >= 0x10 && mode <= 0x1f) return (w >> (mode - 0x10)) & 1;
    return w;
  }

  /** Touch at (x, y) inside touch entry `e`. */
  press(e: Uint8Array, x = 0, y = 0): PressResult {
    const i = describeTouch(e);
    const events: SimEvent[] = [];
    let input: InputRequest | null = null;
    const vp = i.vp ?? 0;
    switch (i.type) {
      case -1: {
        const code = field(i, "TP_Code");
        if (code >> 8 !== 0xff) events.push({ type: "key", code });
        break;
      }
      case 0x05:
        events.push(this.writeMode(vp, field(i, "VP_Mode"), field(i, "Key_Code"), i.typeName));
        break;
      case 0x02: {
        const mode = field(i, "VP_Mode");
        const step = field(i, "Step");
        const lo = field(i, "V_Min"), hi = field(i, "V_Max");
        const cur = this.readMode(vp, mode);
        let next = field(i, "Adjust") ? cur + step : cur - step;
        if (next > hi) next = field(i, "Return_Mode") ? lo : hi;
        if (next < lo) next = field(i, "Return_Mode") ? hi : lo;
        events.push(this.writeMode(vp, mode, next, i.typeName));
        break;
      }
      case 0x03: {
        const vertical = (field(i, "Adj_Mode") & 0xf0) === 0x10;
        const [s0, s1] = vertical ? [field(i, "Area Ys"), field(i, "Area Ye")] : [field(i, "Area Xs"), field(i, "Area Xe")];
        const pos = vertical ? y : x;
        const t = s1 > s0 ? Math.max(0, Math.min(1, (pos - s0) / (s1 - s0))) : 0;
        const v0 = field(i, "V_begin"), v1 = field(i, "V_end");
        events.push(this.write(vp, 1, Math.round(v0 + t * (v1 - v0)), i.typeName));
        break;
      }
      case 0x00: {
        const vType = field(i, "V_Type");
        const words = vType === 1 ? 2 : vType === 4 ? 4 : 1;
        const lim = field(i, "Limits_EN") === 0xff;
        input = {
          kind: "number", vp, nDot: field(i, "N_Dot"), words, maxBytes: 0,
          min: lim ? field(i, "V_Min") : null, max: lim ? field(i, "V_Max") : null,
          keypadPage: field(i, "KB_Source") ? field(i, "PIC_KB") : null,
        };
        break;
      }
      case 0x06:
        input = {
          kind: "text", vp, nDot: 0, words: 0, maxBytes: field(i, "VP_Len_Max"), min: null, max: null,
          keypadPage: field(i, "KB_Source") ? field(i, "PIC_KB") : null,
        };
        break;
      default:
        events.push({ type: "info", text: `${i.typeName}: not simulated` });
    }
    if (i.jumpTo !== null) {
      this.page = i.jumpTo;
      events.push({ type: "jump", page: i.jumpTo });
    }
    events.push(...events.flatMap((ev) => this.host(ev)));
    this.log.push(...events.filter((x) => x.type !== "write"));
    return { events, input };
  }

  /** Complete a data/text input request. Returns an error message or null. */
  enter(req: InputRequest, value: string): string | null {
    if (req.kind === "text") {
      const bytes = Array.from(new TextEncoder().encode(value)).slice(0, req.maxBytes || 255);
      for (let k = 0; k < bytes.length; k += 2) this.set(req.vp + k / 2, (bytes[k]! << 8) | (bytes[k + 1] ?? 0));
      const end = req.vp + Math.ceil(bytes.length / 2);
      if (bytes.length % 2 === 0) this.set(end, 0xffff);
      this.log.push({ type: "write", vp: req.vp, value: bytes.length, words: Math.ceil(bytes.length / 2), source: `text "${value}"` });
      return null;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return "not a number";
    const raw = Math.round(n * 10 ** req.nDot);
    if (req.min !== null && raw < req.min) return `below the minimum (${req.min / 10 ** req.nDot})`;
    if (req.max !== null && raw > req.max) return `above the maximum (${req.max / 10 ** req.nDot})`;
    const ev = this.write(req.vp, req.words, raw, "number input");
    this.log.push(...this.host(ev));
    return null;
  }

  /** What the display variables of `page` show for the current VPs. */
  render(page: Page): Drawn[] {
    const out: Drawn[] = [];
    for (const c of page.display) {
      const i = describeVar(fromHex(c.bytes));
      const g = (n: string) => field(i, n);
      const vp = i.vp ?? 0;
      switch (i.type) {
        case 0x10: {
          const mode = g("VP_Data_Mode");
          const words = { 0: 1, 1: 2, 4: 4, 5: 1, 6: 2 }[mode] ?? 1;
          const v = mode === 2 ? this.get(vp) >> 8 : mode === 3 ? this.get(vp) & 0xff : this.read(vp, words, mode < 5);
          const dec = g("Dec_Num");
          const intN = g("Int_Num");
          let text = (v / 10 ** dec).toFixed(dec);
          if (intN) {
            const [ip, fp] = text.replace("-", "").split(".");
            const cut = ip!.slice(-intN);
            text = (v < 0 ? "-" : "") + cut + (fp !== undefined ? "." + fp : "");
          }
          const fx = g("Font_X") || 8;
          const ali = g("ALI");
          out.push({
            uid: c.uid, kind: "text", x: g("X"), y: g("Y"), text, color: g("Color"), size: fx * 2,
            align: ali === 0 ? "right" : ali === 2 ? "center" : "left",
          });
          break;
        }
        case 0x11: {
          const len = g("Text_length");
          const bytes: number[] = [];
          for (let k = 0; k < len; k += 2) {
            const w = this.get(vp + k / 2);
            bytes.push(w >> 8, w & 0xff);
          }
          let end = bytes.findIndex((b, k) => b === 0 || (b === 0xff && bytes[k + 1] === 0xff));
          if (end < 0) end = len;
          const unicode = (g("Encode_Mode") & 0x7f) === 5;
          const text = unicode
            ? new TextDecoder("utf-16be").decode(new Uint8Array(bytes.slice(0, end & ~1)))
            : String.fromCharCode(...bytes.slice(0, end));
          out.push({
            uid: c.uid, kind: "text", x: g("X"), y: g("Y"), text, color: g("Color"), size: g("Font_Y") || 16,
            align: "left", box: [g("Xs"), g("Ys"), g("Xe"), g("Ye")],
          });
          break;
        }
        case 0x00: {
          const v = this.read(vp, 1, true);
          if (v >= g("V_Min") && v <= g("V_Max")) {
            out.push({ uid: c.uid, kind: "icon", x: g("X"), y: g("Y"),
              icon: { lib: g("Icon_Lib"), id: g("Icon_Min") + v - g("V_Min"), transparent: g("Mode") === 0 } });
          }
          break;
        }
        case 0x01: {
          const v = this.get(vp);
          const id = v === g("V_Start") ? g("Icon_Start") : v === g("V_Stop") ? g("Icon_Stop") : null;
          if (id !== null) {
            out.push({ uid: c.uid, kind: "icon", x: g("X"), y: g("Y"),
              icon: { lib: g("Icon_Lib"), id, transparent: g("Mode") === 0 } });
          }
          break;
        }
        case 0x06: {
          const on = (this.get(vp) & g("Act_Bit_Set")) !== 0;
          out.push({ uid: c.uid, kind: "icon", x: g("X"), y: g("Y"),
            icon: { lib: g("Icon_Lib"), id: on ? g("ICON1S") : g("ICON0S"), transparent: g("Icon_Mode") === 0 } });
          break;
        }
        case 0x02: {
          const v0 = g("V_begin"), v1 = g("V_end");
          const v = this.get(vp);
          const t = v1 !== v0 ? Math.max(0, Math.min(1, (v - v0) / (v1 - v0))) : 0;
          const pos = Math.round(g("X_begin") + t * (g("X_end") - g("X_begin")));
          const vertical = g("Mode") === 1;
          out.push({ uid: c.uid, kind: "icon", x: vertical ? g("Y") : pos, y: vertical ? pos : g("Y"),
            icon: { lib: g("Icon_Lib"), id: g("Icon_ID"), transparent: g("Icon_Mode") === 0 } });
          break;
        }
      }
    }
    return out;
  }
}

// Field descriptors for touch areas (13*.BIN) and display variables
// (14*.BIN), from the DGUS Development Guide V4.3 ch. 7-8. One table drives
// decoding for the inspector, bounds for the canvas and (M2) editing.
// Offsets are byte offsets into the raw entry.
import { u16, u32, u8 } from "../bytes";
import { TOUCH_NAMES, isFunctionCode, readHead, type Rect } from "../formats/touch13";
import { VAR_NAMES, varType } from "../formats/var14";

export type FieldFmt = "dec" | "hex" | "vp" | "color" | "page" | "icon" | "lib" | "bool" | "signed" | "ascii";

export interface FieldSpec {
  name: string;
  off: number;
  size: 1 | 2 | 4;
  fmt?: FieldFmt;
  note?: string;
}

export interface Field extends FieldSpec {
  value: number;
}

export interface ControlInfo {
  kind: "touch" | "display";
  type: number; // function / variable type; -1 = plain key
  typeName: string;
  vp: number | null;
  /** On-screen box (inclusive), possibly an estimate. */
  bounds: Rect | null;
  estimated: boolean;
  fields: Field[];
  /** Page this touch jumps to, if any. */
  jumpTo: number | null;
  /** Icon to preview: [libId, iconId, x, y, transparent]. */
  icon: [number, number, number, number, boolean] | null;
}

const f = (name: string, off: number, size: 1 | 2 | 4, fmt?: FieldFmt, note?: string): FieldSpec =>
  ({ name, off, size, fmt, note });

// --- touch -----------------------------------------------------------------
const TOUCH_HEAD: FieldSpec[] = [
  f("Flags", 0, 1, "hex", ".3 = click sound"),
  f("Page", 1, 1, "page"),
  f("Xs", 2, 2), f("Ys", 4, 2), f("Xe", 6, 2), f("Ye", 8, 2),
  f("Pic_Next", 10, 2, "page", "0xFF.. = no page switch"),
  f("Pic_On", 12, 2, "page", "0xFF.. = no press effect"),
  f("TP_Code", 14, 2, "hex", "0xFE.. function (0xFD.. = no auto upload)"),
];

const TOUCH_FUNC: Record<number, FieldSpec[]> = {
  0x00: [
    f("VP", 17, 2, "vp"), f("V_Type", 19, 1, "hex", "0 int16, 1 int32, 2 high byte, 3 low byte"),
    f("N_Int", 20, 1), f("N_Dot", 21, 1), f("Cursor X", 22, 2), f("Cursor Y", 24, 2),
    f("Color", 26, 2, "color"), f("Lib_ID", 28, 1, "lib"), f("Font_X", 29, 1),
    f("Cursor_Color", 30, 1, "hex"), f("Hide", 31, 1, "hex"),
    f("KB_Source", 33, 1, "hex", "0 = current page, 1 = other page"), f("PIC_KB", 34, 2, "page"),
    f("KB Xs", 36, 2), f("KB Ys", 38, 2), f("KB Xe", 40, 2), f("KB Ye", 42, 2),
    f("KB X", 44, 2), f("KB Y", 46, 2),
    f("Limits_EN", 49, 1, "hex", "0xFF = limits on"), f("V_Min", 50, 4, "signed"), f("V_Max", 54, 4, "signed"),
  ],
  0x01: [
    f("VP", 17, 2, "vp"), f("VP_Mode", 19, 1, "hex"),
    f("Menu page", 20, 2, "page"), f("Menu Xs", 22, 2), f("Menu Ys", 24, 2), f("Menu Xe", 26, 2), f("Menu Ye", 28, 2),
    f("Menu X", 30, 2), f("Menu Y", 33, 2),
  ],
  0x02: [
    f("VP", 17, 2, "vp"), f("VP_Mode", 19, 1, "hex"), f("Adjust", 20, 1, "hex", "0 = -, 1 = +"),
    f("Return_Mode", 21, 1, "hex"), f("Step", 22, 2), f("V_Min", 24, 2), f("V_Max", 26, 2),
    f("Key_Mode", 28, 1, "hex"),
  ],
  0x03: [
    f("VP", 17, 2, "vp"), f("Adj_Mode", 19, 1, "hex", "0x0* horizontal, 0x1* vertical"),
    f("Area Xs", 20, 2), f("Area Ys", 22, 2), f("Area Xe", 24, 2), f("Area Ye", 26, 2),
    f("V_begin", 28, 2), f("V_end", 30, 2),
  ],
  0x05: [
    f("VP", 17, 2, "vp"), f("VP_Mode", 19, 1, "hex", "0 word, 1 high, 2 low, 0x10-0x1F bit"),
    f("Key_Code", 20, 2, "hex"),
  ],
  0x06: [
    f("VP", 17, 2, "vp"), f("VP_Len_Max", 19, 1), f("Scan_Mode", 20, 1, "hex"), f("Lib_ID", 21, 1, "lib"),
    f("Font_X", 22, 1), f("Font_Y", 23, 1), f("Cursor_Color", 24, 1, "hex"), f("Color", 25, 2, "color"),
    f("Text Xs", 27, 2), f("Text Ys", 29, 2), f("Text Xe", 33, 2), f("Text Ye", 35, 2),
    f("KB_Source", 37, 1, "hex"), f("PIC_KB", 38, 2, "page"),
  ],
  0x09: [
    f("VP", 17, 2, "vp"), f("Data_Format", 19, 1, "hex"), f("Xc", 20, 2), f("Yc", 22, 2),
    f("R0", 24, 2), f("R1", 26, 2), f("A0", 28, 2), f("V_begin", 30, 2), f("A1", 33, 2), f("V_end", 35, 2),
  ],
};

// --- display ---------------------------------------------------------------
const VAR_HEAD: FieldSpec[] = [f("Type", 1, 1, "hex"), f("SP", 2, 2, "hex"), f("Length (words)", 4, 2)];
const VP = f("VP", 6, 2, "vp");
const XY = [f("X", 8, 2), f("Y", 10, 2)];

const VAR_FIELDS: Record<number, FieldSpec[]> = {
  0x00: [VP, ...XY, f("V_Min", 12, 2), f("V_Max", 14, 2), f("Icon_Min", 16, 2, "icon"), f("Icon_Max", 18, 2, "icon"),
    f("Icon_Lib", 20, 1, "lib"), f("Mode", 21, 1, "hex", "0 = transparent")],
  0x01: [VP, ...XY, f("V_Stop", 14, 2), f("V_Start", 16, 2), f("Icon_Stop", 18, 2, "icon"),
    f("Icon_Start", 20, 2, "icon"), f("Icon_End", 22, 2, "icon"), f("Icon_Lib", 24, 1, "lib"), f("Mode", 25, 1, "hex")],
  0x02: [VP, f("V_begin", 8, 2), f("V_end", 10, 2), f("X_begin", 12, 2), f("X_end", 14, 2),
    f("Icon_ID", 16, 2, "icon"), f("Y", 18, 2), f("X_adj", 20, 1), f("Mode", 21, 1, "hex", "0 horizontal, 1 vertical"),
    f("Icon_Lib", 22, 1, "lib"), f("Icon_Mode", 23, 1, "hex"), f("VP_Data_Mode", 24, 1, "hex")],
  0x03: [VP, ...XY, f("Icon0", 12, 2, "icon"), f("Icon_Lib", 14, 1, "lib"), f("Icon_Mode", 15, 1, "hex"),
    f("Int_Num", 16, 1), f("Dec_Num", 17, 1), f("VP_Data_Mode", 18, 1, "hex"), f("ALI", 19, 1, "hex")],
  0x04: [f("Pic_Begin", 8, 2, "page"), f("Pic_End", 10, 2, "page"), f("Frame_Time", 12, 1, "dec", "x 8 ms")],
  0x05: [VP, f("Icon_ID", 8, 2, "icon"), f("Icon_Xc", 10, 2), f("Icon_Yc", 12, 2), f("Xc", 14, 2), f("Yc", 16, 2),
    f("V_Begin", 18, 2), f("V_End", 20, 2), f("AL_Begin", 22, 2), f("AL_End", 24, 2), f("VP_Mode", 26, 1, "hex"),
    f("Lib_ID", 27, 1, "lib"), f("Mode", 28, 1, "hex")],
  0x06: [VP, f("VP_AUX", 8, 2, "vp"), f("Act_Bit_Set", 10, 2, "hex"), f("Display_Mode", 12, 1, "hex"),
    f("Move_Mode", 13, 1, "hex"), f("Icon_Mode", 14, 1, "hex"), f("Icon_Lib", 15, 1, "lib"),
    f("ICON0S", 16, 2, "icon"), f("ICON0E", 18, 2, "icon"), f("ICON1S", 20, 2, "icon"), f("ICON1E", 22, 2, "icon"),
    f("X", 24, 2), f("Y", 26, 2), f("DIS_MOV", 28, 2)],
  0x10: [VP, ...XY, f("Color", 12, 2, "color"), f("Lib_ID", 14, 1, "lib"), f("Font_X", 15, 1),
    f("ALI", 16, 1, "hex", "0 right, 1 left, 2 centre"), f("Int_Num", 17, 1), f("Dec_Num", 18, 1),
    f("VP_Data_Mode", 19, 1, "hex"), f("Len_unit", 20, 1)],
  0x11: [VP, ...XY, f("Color", 12, 2, "color"), f("Xs", 14, 2), f("Ys", 16, 2), f("Xe", 18, 2), f("Ye", 20, 2),
    f("Text_length", 22, 2), f("Font0_ID", 24, 1, "lib"), f("Font1_ID", 25, 1, "lib"), f("Font_X", 26, 1),
    f("Font_Y", 27, 1), f("Encode_Mode", 28, 1, "hex"), f("HOR_Dis", 29, 1), f("VER_Dis", 30, 1)],
  0x12: [f("Mode", 6, 2, "hex", "0 digital, 1 analog"), ...XY, f("Color", 12, 2, "color"),
    f("Lib_ID", 14, 1, "lib"), f("Font_X", 15, 1)],
  0x13: [VP, ...XY, f("Color", 12, 2, "color"), f("Byte_Num", 14, 1), f("Lib_ID", 15, 1, "lib"), f("Font_X", 16, 1)],
  0x14: [VP, f("Rolling_Mode", 8, 1, "hex"), f("Rolling_Dis", 9, 1), f("Adjust_Mode", 10, 1, "hex"),
    f("Run_Control", 11, 1, "hex"), f("Color", 12, 2, "color"), f("Xs", 14, 2), f("Ys", 16, 2), f("Xe", 18, 2),
    f("Ye", 20, 2), f("Font0_ID", 22, 1, "lib"), f("Font1_ID", 23, 1, "lib"), f("Font_X", 24, 1), f("Font_Y", 25, 1),
    f("Encode_Mode", 26, 1, "hex"), f("Text_Dis", 27, 1)],
  0x20: [f("Xs", 8, 2), f("Ys", 10, 2), f("Xe", 12, 2), f("Ye", 14, 2), f("Y_Central", 16, 2)],
};

function read(e: Uint8Array, s: FieldSpec): number {
  if (s.off + s.size > e.length) return NaN;
  if (s.size === 1) return u8(e, s.off);
  if (s.size === 2) return u16(e, s.off);
  const v = u32(e, s.off);
  return s.fmt === "signed" ? v | 0 : v;
}

function decode(e: Uint8Array, specs: FieldSpec[]): Field[] {
  return specs.map((s) => ({ ...s, value: read(e, s) })).filter((x) => !Number.isNaN(x.value));
}

const get = (fields: Field[], name: string) => fields.find((x) => x.name === name)?.value ?? 0;

export function describeTouch(e: Uint8Array): ControlInfo {
  const h = readHead(e);
  const fn = isFunctionCode(h.code) ? h.code & 0xff : -1;
  const fields = decode(e, [...TOUCH_HEAD, ...(fn >= 0 ? TOUCH_FUNC[fn] ?? [] : [])]);
  const vpField = fields.find((x) => x.fmt === "vp");
  let typeName = fn >= 0 ? TOUCH_NAMES[fn] ?? `Function 0x${fn.toString(16)}` : "Key";
  if (fn < 0) {
    const ch = h.code & 0xff;
    typeName = h.code >> 8 === 0xff ? "Button (no key code)"
      : ch >= 0x20 && ch < 0x7f ? `Key '${String.fromCharCode(ch)}'` : `Key 0x${h.code.toString(16).padStart(4, "0")}`;
  }
  return {
    kind: "touch", type: fn, typeName, vp: vpField ? vpField.value : null,
    bounds: h.area, estimated: false, fields,
    jumpTo: h.picNext >> 8 === 0xff ? null : h.picNext,
    icon: null,
  };
}

export function describeVar(e: Uint8Array, iconSize?: (lib: number, id: number) => [number, number] | null): ControlInfo {
  const t = varType(e) ?? -1;
  const fields = decode(e, [...VAR_HEAD, ...(VAR_FIELDS[t] ?? [])]);
  const g = (n: string) => get(fields, n);
  let bounds: Rect | null = null;
  let estimated = true;
  let icon: ControlInfo["icon"] = null;
  const iconBox = (lib: number, id: number, x: number, y: number, transparent: boolean): Rect => {
    icon = [lib, id, x, y, transparent];
    const s = iconSize?.(lib, id);
    if (s) estimated = false;
    const [w, h] = s ?? [24, 24];
    return [x, y, x + w - 1, y + h - 1];
  };
  switch (t) {
    case 0x00: bounds = iconBox(g("Icon_Lib"), g("Icon_Min"), g("X"), g("Y"), g("Mode") === 0); break;
    case 0x01: bounds = iconBox(g("Icon_Lib"), g("Icon_Stop"), g("X"), g("Y"), g("Mode") === 0); break;
    case 0x06: bounds = iconBox(g("Icon_Lib"), g("ICON0S"), g("X"), g("Y"), g("Icon_Mode") === 0); break;
    case 0x02: {
      const s = iconSize?.(g("Icon_Lib"), g("Icon_ID")) ?? [16, 16];
      bounds = g("Mode") === 0
        ? [g("X_begin"), g("Y"), g("X_end") + s[0] - 1, g("Y") + s[1] - 1]
        : [g("Y"), g("X_begin"), g("Y") + s[0] - 1, g("X_end") + s[1] - 1];
      break;
    }
    case 0x03: {
      const s = iconSize?.(g("Icon_Lib"), g("Icon0")) ?? [16, 24];
      const n = g("Int_Num") + g("Dec_Num") + (g("Dec_Num") ? 1 : 0);
      bounds = [g("X"), g("Y"), g("X") + s[0] * Math.max(n, 1) - 1, g("Y") + s[1] - 1];
      break;
    }
    case 0x10: {
      const fx = g("Font_X") || 8;
      const n = g("Int_Num") + g("Dec_Num") + (g("Dec_Num") ? 1 : 0) + 1;
      const w = (fx * n);
      const x = g("ALI") === 0 ? g("X") - w + 1 : g("ALI") === 2 ? g("X") - (w >> 1) : g("X");
      bounds = [Math.max(0, x), g("Y"), Math.max(0, x) + w - 1, g("Y") + fx * 2 - 1];
      break;
    }
    case 0x11: case 0x14: bounds = [g("Xs"), g("Ys"), g("Xe"), g("Ye")]; estimated = false; break;
    case 0x12: case 0x13: {
      const fx = g("Font_X") || 8;
      bounds = [g("X"), g("Y"), g("X") + fx * 10 - 1, g("Y") + fx * 2 - 1];
      break;
    }
    case 0x20: bounds = [g("Xs"), g("Ys"), g("Xe"), g("Ye")]; estimated = false; break;
    case 0x05: bounds = [g("Xc") - 20, g("Yc") - 20, g("Xc") + 20, g("Yc") + 20]; break;
  }
  const vpField = fields.find((x) => x.fmt === "vp");
  return {
    kind: "display", type: t, typeName: VAR_NAMES[t] ?? `Type 0x${t.toString(16)}`,
    vp: vpField ? vpField.value : null, bounds, estimated, fields, jumpTo: null, icon,
  };
}

export function formatField(x: Field): string {
  const h = (n: number, d: number) => "0x" + n.toString(16).toUpperCase().padStart(d, "0");
  switch (x.fmt) {
    case "hex": return h(x.value, x.size * 2);
    case "vp": return h(x.value, 4);
    case "color": return h(x.value, 4);
    case "page": return x.value >> 8 === 0xff ? "none" : String(x.value);
    default: return String(x.value);
  }
}

// Who uses which VP (variable pointer) and where ranges clash.
import { fromHex } from "../bytes";
import { describeTouch, describeVar, type ControlInfo } from "../controls/describe";
import type { ProjectDoc } from "./schema";

export interface VpUse {
  vp: number;
  words: number;
  page: number;
  uid: string;
  kind: "touch" | "display";
  typeName: string;
  /** "write": the control writes the VP (touch); "read": displays it. */
  access: "read" | "write";
  note?: string;
}

const g = (i: ControlInfo, name: string) => i.fields.find((f) => f.name === name)?.value ?? 0;
const NUM_WORDS: Record<number, number> = { 0: 1, 1: 2, 2: 1, 3: 1, 4: 4, 5: 1, 6: 2 };

/** VP words used by a control, from its type and format fields. */
export function vpWords(i: ControlInfo): number {
  if (i.kind === "touch") {
    switch (i.type) {
      case 0x00: return NUM_WORDS[g(i, "V_Type")] ?? 1;
      case 0x06: return Math.max(1, Math.ceil(g(i, "VP_Len_Max") / 2));
      default: return 1;
    }
  }
  switch (i.type) {
    case 0x03: return NUM_WORDS[g(i, "VP_Data_Mode")] ?? 1;
    case 0x10: return NUM_WORDS[g(i, "VP_Data_Mode")] ?? 1;
    case 0x11: return Math.max(1, Math.ceil(g(i, "Text_length") / 2));
    case 0x13: return Math.max(1, Math.ceil(g(i, "Byte_Num") / 2));
    default: return 1;
  }
}

export function vpUses(doc: ProjectDoc): VpUse[] {
  const out: VpUse[] = [];
  for (const pg of doc.project.pages) {
    for (const c of pg.touch) {
      const i = describeTouch(fromHex(c.bytes));
      if (i.vp === null) continue;
      out.push({ vp: i.vp, words: vpWords(i), page: pg.id, uid: c.uid, kind: "touch", typeName: i.typeName, access: "write" });
    }
    for (const c of pg.display) {
      const i = describeVar(fromHex(c.bytes));
      if (i.vp === null) continue;
      out.push({ vp: i.vp, words: vpWords(i), page: pg.id, uid: c.uid, kind: "display", typeName: i.typeName, access: "read" });
      if (i.type === 0x06) {
        out.push({
          vp: g(i, "VP_AUX"), words: 2, page: pg.id, uid: c.uid, kind: "display", typeName: i.typeName,
          access: "write", note: "reserved by the screen (VP_AUX)",
        });
      }
    }
  }
  return out.sort((a, b) => a.vp - b.vp || a.page - b.page);
}

export interface VpClash {
  a: VpUse;
  b: VpUse;
}

/** Ranges that overlap but start at different VPs (sharing the same VP is
 * normal: a button writes what a display shows). */
export function vpClashes(uses: VpUse[]): VpClash[] {
  const out: VpClash[] = [];
  const sorted = [...uses].sort((a, b) => a.vp - b.vp);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.vp >= a.vp + a.words) break;
      if (b.vp !== a.vp && b.uid !== a.uid) out.push({ a, b });
    }
  }
  return out;
}

/** First VP >= start with `words` free words. */
export function allocVp(doc: ProjectDoc, words: number, start = 0x1000, end = 0x6fff): number {
  if (words <= 0) return 0;
  const used = vpUses(doc).map((u) => [u.vp, u.vp + u.words] as const).sort((a, b) => a[0] - b[0]);
  let vp = start;
  for (const [s, e] of used) {
    if (e <= vp) continue;
    if (s >= vp + words) break;
    vp = e;
  }
  if (vp + words - 1 > end) throw new Error("no free VP range");
  return vp;
}

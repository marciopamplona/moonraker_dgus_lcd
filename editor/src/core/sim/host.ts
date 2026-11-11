// Host rules: what the printer service does in reply to key codes, as far
// as page switching goes (see dgus_lcd/firmware/dgus_reloaded/vars_in.cfg).
import { fromHex } from "../bytes";
import { describeTouch } from "../controls/describe";
import type { HostRule, ProjectDoc } from "../project/schema";

/** DGUS-reloaded: 0x2000 always switches to page <value>; 0x2002 when the
 * printer is idle, 0x2003 while printing (both treated as always here). */
export const DGUS_RELOADED_RULES: HostRule[] = [
  { vp: 0x2000, note: "switch page" },
  { vp: 0x2002, note: "switch page (when idle)" },
  { vp: 0x2003, note: "switch page (while printing)" },
];

/** Rules to use when the project has none saved: DGUS-reloaded's if its
 * return keys write page ids to 0x2000, else none. */
export function detectHostRules(doc: ProjectDoc): HostRule[] {
  const ids = new Set(doc.project.pages.map((p) => p.id));
  let hits = 0, total = 0;
  for (const pg of doc.project.pages) {
    for (const c of pg.touch) {
      const i = describeTouch(fromHex(c.bytes));
      if (i.type !== 0x05 || i.vp !== 0x2000) continue;
      total++;
      if (ids.has(i.fields.find((f) => f.name === "Key_Code")!.value)) hits++;
    }
  }
  return total && hits / total >= 0.8 ? DGUS_RELOADED_RULES.map((r) => ({ ...r })) : [];
}

export function hostRules(doc: ProjectDoc): { rules: HostRule[]; detected: boolean } {
  if (doc.project.sim) return { rules: doc.project.sim.rules, detected: false };
  return { rules: detectHostRules(doc), detected: true };
}

/** Page the host switches to after `vp` is written with `value`, or null. */
export function hostTarget(rules: HostRule[], vp: number, value: number): number | null {
  for (const r of rules) {
    if (r.vp !== vp) continue;
    if (r.value === undefined) return value;
    if (r.value === value && r.page !== undefined) return r.page;
  }
  return null;
}

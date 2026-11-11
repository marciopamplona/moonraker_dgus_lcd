import { fromHex } from "../core/bytes";
import { describeTouch, describeVar, type ControlInfo } from "../core/controls/describe";
import type { Control, Page, ProjectDoc } from "../core/project/schema";
import { hostRules, hostTarget } from "../core/sim/host";
import { iconSizeFn } from "./render";

export interface PlacedControl {
  kind: "touch" | "display";
  control: Control;
  info: ControlInfo;
  bytes: Uint8Array;
}

export function pageControls(doc: ProjectDoc, page: Page): PlacedControl[] {
  const size = iconSizeFn(doc);
  return [
    ...page.display.map((c) => {
      const bytes = fromHex(c.bytes);
      return { kind: "display" as const, control: c, bytes, info: describeVar(bytes, size) };
    }),
    ...page.touch.map((c) => {
      const bytes = fromHex(c.bytes);
      return { kind: "touch" as const, control: c, bytes, info: describeTouch(bytes) };
    }),
  ];
}

export function vpHex(vp: number | null): string {
  return vp === null ? "—" : "0x" + vp.toString(16).toUpperCase().padStart(4, "0");
}

/** Page a control leads to: its own Pic_Next, or (for a return key) the
 * page the host switches to according to the host rules. */
export function jumpOf(doc: ProjectDoc, info: ControlInfo): { page: number; via: "screen" | "host" } | null {
  if (info.jumpTo !== null) return { page: info.jumpTo, via: "screen" };
  if (info.kind === "touch" && info.type === 0x05 && info.vp !== null) {
    const mode = info.fields.find((f) => f.name === "VP_Mode")?.value ?? 0;
    const key = info.fields.find((f) => f.name === "Key_Code")?.value ?? 0;
    const to = mode === 0 ? hostTarget(hostRules(doc).rules, info.vp, key) : null;
    if (to !== null) return { page: to, via: "host" };
  }
  return null;
}

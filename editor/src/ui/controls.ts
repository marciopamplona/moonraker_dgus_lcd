import { fromHex } from "../core/bytes";
import { describeTouch, describeVar, type ControlInfo } from "../core/controls/describe";
import type { Control, Page, ProjectDoc } from "../core/project/schema";
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

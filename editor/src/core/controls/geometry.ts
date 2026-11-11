// Moving and resizing controls by rewriting their position fields.
import type { Rect } from "../formats/touch13";
import { fieldSpecs, readField, writeField, type FieldSpec } from "./describe";

export type Kind = "touch" | "display";

const X_GEO = new Set(["x", "xs", "xe"]);
const Y_GEO = new Set(["y", "ys", "ye"]);

function geoFields(kind: Kind, e: Uint8Array): FieldSpec[] {
  return fieldSpecs(kind, e).filter((s) => s.geo);
}

/** True when the control has a box whose edges can be dragged. */
export function resizable(kind: Kind, e: Uint8Array): boolean {
  const geos = new Set(geoFields(kind, e).map((s) => s.geo));
  return ["xs", "ys", "xe", "ye"].every((g) => geos.has(g as never));
}

export function canMove(kind: Kind, e: Uint8Array): boolean {
  return geoFields(kind, e).length > 0;
}

/** Move by (dx, dy). The shift is limited so no position goes below 0 or
 * past the screen (w, h). */
export function moveBy(kind: Kind, e: Uint8Array, dx: number, dy: number, w = 480, h = 272): Uint8Array {
  const fs = geoFields(kind, e);
  const xs = fs.filter((s) => X_GEO.has(s.geo!)).map((s) => readField(e, s));
  const ys = fs.filter((s) => Y_GEO.has(s.geo!)).map((s) => readField(e, s));
  const clamp = (d: number, vals: number[], max: number) =>
    vals.length ? Math.max(-Math.min(...vals), Math.min(max - 1 - Math.max(...vals), d)) : 0;
  const cx = clamp(Math.round(dx), xs, w);
  const cy = clamp(Math.round(dy), ys, h);
  let out = e;
  for (const s of fs) {
    const d = X_GEO.has(s.geo!) ? cx : cy;
    if (d) out = writeField(out, s, readField(out, s) + d);
  }
  return out;
}

/** Set the resizable box (normalised and clipped to the screen). Fields
 * tagged "x"/"y" (e.g. a text's anchor) follow the box's top-left corner. */
export function setBox(kind: Kind, e: Uint8Array, r: Rect, w = 480, h = 272): Uint8Array {
  const fs = geoFields(kind, e);
  const get = (g: string) => fs.find((s) => s.geo === g);
  const xs = get("xs"), ys = get("ys"), xe = get("xe"), ye = get("ye");
  if (!xs || !ys || !xe || !ye) return e;
  const cl = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(v)));
  const nx0 = cl(Math.min(r[0], r[2]), w), nx1 = cl(Math.max(r[0], r[2]), w);
  const ny0 = cl(Math.min(r[1], r[3]), h), ny1 = cl(Math.max(r[1], r[3]), h);
  const dx = nx0 - readField(e, xs), dy = ny0 - readField(e, ys);
  let out = e;
  out = writeField(out, xs, nx0);
  out = writeField(out, ys, ny0);
  out = writeField(out, xe, nx1);
  out = writeField(out, ye, ny1);
  for (const s of fs) {
    if (s.geo === "x" && dx) out = writeField(out, s, cl(readField(out, s) + dx, w));
    if (s.geo === "y" && dy) out = writeField(out, s, cl(readField(out, s) + dy, h));
  }
  return out;
}

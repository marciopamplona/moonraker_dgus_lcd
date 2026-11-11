// Edits on a ProjectDoc. They mutate the doc they are given (the store
// hands them a fresh copy) and return useful ids.
import { fromHex, hex } from "../bytes";
import { fieldSpecs, readField, writeField } from "../controls/describe";
import { moveBy, type Kind } from "../controls/geometry";
import { Bitmap } from "../formats/bmp";
import { decodeCfg, encodeCfg } from "../formats/cfg";
import { fileName } from "../formats/dwinset";
import { T5UID1 } from "../profile/t5uid1";
import { newId, type Control, type Page, type ProjectDoc } from "./schema";

export const MAX_TOUCH_PAGE = 255;

export function getPage(doc: ProjectDoc, id: number): Page {
  const p = doc.project.pages.find((x) => x.id === id);
  if (!p) throw new Error(`no page ${id}`);
  return p;
}

export interface Found {
  page: Page;
  kind: Kind;
  index: number;
  control: Control;
}

export function findControl(doc: ProjectDoc, uid: string): Found | null {
  for (const page of doc.project.pages) {
    for (const kind of ["touch", "display"] as const) {
      const index = page[kind].findIndex((c) => c.uid === uid);
      if (index >= 0) return { page, kind, index, control: page[kind][index]! };
    }
  }
  return null;
}

function sortPages(doc: ProjectDoc): void {
  doc.project.pages.sort((a, b) => a.id - b.id);
}

function usedNames(doc: ProjectDoc): Set<string> {
  return new Set([...doc.project.files.map((f) => f.name), ...doc.project.pages.flatMap((p) => p.background ?? [])]);
}

export function freePageId(doc: ProjectDoc, from = 0): number {
  const ids = new Set(doc.project.pages.map((p) => p.id));
  let id = from;
  while (ids.has(id)) id++;
  return id;
}

/** New page with a plain background in `rgb`. */
export function addPage(doc: ProjectDoc, opts: { id?: number; name?: string; rgb?: [number, number, number] } = {}): Page {
  const id = opts.id ?? freePageId(doc, 0);
  if (doc.project.pages.some((p) => p.id === id)) throw new Error(`page ${id} exists`);
  const name = opts.name ?? `page${id}`;
  const { w, h } = T5UID1.screen;
  const bm = new Bitmap(w, h);
  const [r, g, b] = opts.rgb ?? [0, 0, 0];
  for (let i = 0; i < bm.px.length; i += 3) bm.px.set([r, g, b], i);
  const file = fileName("bitmap", id, name, "bmp");
  if (usedNames(doc).has(file)) throw new Error(`file ${file} exists`);
  doc.assets.set(file, bm.save());
  const page: Page = { id, name, background: file, touch: [], display: [] };
  doc.project.pages.push(page);
  sortPages(doc);
  return page;
}

/** Remove a page and its picture. Returns how many references to it
 * remain in other controls (they are left as they are). */
export function deletePage(doc: ProjectDoc, id: number): number {
  const p = getPage(doc, id);
  if (p.background) doc.assets.delete(p.background);
  doc.project.pages = doc.project.pages.filter((x) => x !== p);
  return countPageRefs(doc, id);
}

function pageFields(kind: Kind, e: Uint8Array) {
  return fieldSpecs(kind, e).filter((s) => s.fmt === "page");
}

export function countPageRefs(doc: ProjectDoc, id: number): number {
  let n = 0;
  for (const pg of doc.project.pages) {
    for (const kind of ["touch", "display"] as const) {
      for (const c of pg[kind]) {
        const e = fromHex(c.bytes);
        for (const s of pageFields(kind, e)) if (s.name !== "Page" && readField(e, s) === id) n++;
      }
    }
  }
  return n;
}

/** Give a page a new id, updating its picture name and every reference to
 * it (Pic_Next / Pic_On / keypad / popup / animation pages, CFG boot page).
 * Returns the number of references changed. */
export function renumberPage(doc: ProjectDoc, from: number, to: number): number {
  if (from === to) return 0;
  if (doc.project.pages.some((p) => p.id === to)) throw new Error(`page ${to} exists`);
  if (to < 0 || to > 0xfeff) throw new Error("page id out of range");
  const p = getPage(doc, from);
  if (p.touch.length && to > MAX_TOUCH_PAGE) throw new Error(`pages with touch areas must have an id <= ${MAX_TOUCH_PAGE}`);
  let refs = 0;
  for (const pg of doc.project.pages) {
    for (const kind of ["touch", "display"] as const) {
      for (const c of pg[kind]) {
        let e = fromHex(c.bytes);
        for (const s of pageFields(kind, e)) {
          if (readField(e, s) === from) {
            e = writeField(e, s, to);
            if (s.name !== "Page") refs++;
          }
        }
        c.bytes = hex(e);
      }
    }
  }
  p.id = to;
  if (p.background) renameAsset(doc, p, fileName("bitmap", to, p.name, "bmp"));
  const cfg = doc.project.files.find((f) => f.kind === "config");
  const data = cfg && doc.assets.get(cfg.name);
  if (cfg && data) {
    const c = decodeCfg(data);
    if (c.bootPage === from) {
      c.bootPage = to;
      doc.assets.set(cfg.name, encodeCfg(c, data));
      refs++;
    }
  }
  sortPages(doc);
  return refs;
}

function renameAsset(doc: ProjectDoc, p: Page, name: string): void {
  if (!p.background || p.background === name) return;
  if (usedNames(doc).has(name)) throw new Error(`file ${name} exists`);
  const data = doc.assets.get(p.background)!;
  doc.assets.delete(p.background);
  doc.assets.set(name, data);
  p.background = name;
}

export function renamePage(doc: ProjectDoc, id: number, name: string): void {
  const p = getPage(doc, id);
  const clean = name.trim() || `page${id}`;
  p.name = clean;
  if (p.background) renameAsset(doc, p, fileName("bitmap", id, clean, "bmp"));
}

export function duplicatePage(doc: ProjectDoc, id: number, to = freePageId(doc, id + 1)): Page {
  const src = getPage(doc, id);
  if (src.touch.length && to > MAX_TOUCH_PAGE) throw new Error(`pages with touch areas must have an id <= ${MAX_TOUCH_PAGE}`);
  const name = src.name + "_copy";
  let background: string | null = null;
  if (src.background) {
    background = fileName("bitmap", to, name, "bmp");
    if (usedNames(doc).has(background)) throw new Error(`file ${background} exists`);
    doc.assets.set(background, doc.assets.get(src.background)!.slice());
  }
  const page: Page = {
    id: to, name, background,
    touch: src.touch.map((c) => ({ uid: newId("t"), bytes: hex(setTouchPage(fromHex(c.bytes), to)) })),
    display: src.display.map((c) => ({ uid: newId("d"), bytes: c.bytes })),
  };
  doc.project.pages.push(page);
  sortPages(doc);
  return page;
}

/** Replace a page's picture with BMP data. */
export function setBackground(doc: ProjectDoc, id: number, bmp: Uint8Array): void {
  const p = getPage(doc, id);
  Bitmap.load(bmp); // validate
  const name = p.background ?? fileName("bitmap", id, p.name, "bmp");
  if (!p.background && usedNames(doc).has(name)) throw new Error(`file ${name} exists`);
  doc.assets.set(name, bmp);
  p.background = name;
}

function setTouchPage(e: Uint8Array, page: number): Uint8Array {
  const out = e.slice();
  out[1] = page;
  return out;
}

// --- controls ----------------------------------------------------------------

export function addControl(doc: ProjectDoc, pageId: number, kind: Kind, bytes: Uint8Array): string {
  const p = getPage(doc, pageId);
  if (kind === "touch" && pageId > MAX_TOUCH_PAGE) throw new Error(`touch areas need a page id <= ${MAX_TOUCH_PAGE}`);
  if (kind === "display" && p.display.length >= 255) throw new Error("at most 255 display variables per page");
  const uid = newId(kind === "touch" ? "t" : "d");
  p[kind].push({ uid, bytes: hex(kind === "touch" ? setTouchPage(bytes, pageId) : bytes) });
  return uid;
}

export function updateControl(doc: ProjectDoc, uid: string, bytes: Uint8Array): void {
  const f = findControl(doc, uid);
  if (!f) throw new Error("control not found");
  const old = fromHex(f.control.bytes);
  if (bytes.length !== old.length) throw new Error(`entry must stay ${old.length} bytes`);
  f.control.bytes = hex(f.kind === "touch" ? setTouchPage(bytes, f.page.id) : bytes);
}

export function deleteControl(doc: ProjectDoc, uid: string): void {
  const f = findControl(doc, uid);
  if (f) f.page[f.kind].splice(f.index, 1);
}

export function duplicateControl(doc: ProjectDoc, uid: string, dx = 8, dy = 8): string {
  const f = findControl(doc, uid);
  if (!f) throw new Error("control not found");
  const bytes = moveBy(f.kind, fromHex(f.control.bytes), dx, dy);
  const nu = newId(f.kind === "touch" ? "t" : "d");
  f.page[f.kind].splice(f.index + 1, 0, { uid: nu, bytes: hex(bytes) });
  return nu;
}

/** Move within its list: later entries are drawn on top (display) and
 * win over earlier ones (touch). */
export function reorderControl(doc: ProjectDoc, uid: string, delta: number): void {
  const f = findControl(doc, uid);
  if (!f) return;
  const list = f.page[f.kind];
  const to = Math.max(0, Math.min(list.length - 1, f.index + delta));
  list.splice(f.index, 1);
  list.splice(to, 0, f.control);
}

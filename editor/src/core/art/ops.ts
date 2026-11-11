// Artwork edits on a ProjectDoc, and flattening to the page's BMP.
import { Bitmap } from "../formats/bmp";
import { fileName } from "../formats/dwinset";
import { readHead, writeHead } from "../formats/touch13";
import { fromHex, hex } from "../bytes";
import { freePageId, getPage } from "../project/ops";
import type { Page, ProjectDoc } from "../project/schema";
import { T5UID1 } from "../profile/t5uid1";
import { quantize565 } from "./dither";
import { renderArt, type ArtEnv, type Ctx } from "./render";
import { artAssets, layerId, newLayer, type Artwork, type Layer } from "./schema";

export interface FlattenEnv extends ArtEnv {
  /** A w x h canvas whose pixels can be read back. */
  canvas(w: number, h: number): { getContext(id: "2d"): Ctx | null } & CanvasImageSource;
}

/** The page's artwork, created on first use: an imported picture becomes
 * the bottom image layer (its bytes are copied to an art/ asset). */
export function ensureArt(doc: ProjectDoc, pageId: number): Artwork {
  const p = getPage(doc, pageId);
  if (p.art) return p.art;
  const art: Artwork = { layers: [], background: "#000000", dither: false };
  const bg = p.background ? doc.assets.get(p.background) : undefined;
  if (bg) {
    const key = `art/${p.id}-base-${layerId()}.bmp`;
    doc.assets.set(key, bg);
    const { w, h } = T5UID1.screen;
    art.layers.push({ ...newLayer("image", { x: 0, y: 0, w, h }), asset: key, name: "Original picture", locked: true } as Layer);
  }
  p.art = art;
  return art;
}

/** Render the page's artwork into its BMP asset (creating the file name if
 * the page has no picture yet). */
export function flattenPage(doc: ProjectDoc, pageId: number, env: FlattenEnv): void {
  const p = getPage(doc, pageId);
  if (!p.art) return;
  const { w, h } = T5UID1.screen;
  const c = env.canvas(w, h);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas not available");
  renderArt(p.art, ctx, w, h, env);
  const img = ctx.getImageData(0, 0, w, h);
  if (p.art.dither) quantize565(img.data, w, h, true);
  const name = p.background ?? fileName("bitmap", p.id, p.name, "bmp");
  doc.assets.set(name, Bitmap.fromRGBA(w, h, img.data).save());
  p.background = name;
}

/** Apply `fn` to the page's artwork, flatten, drop unused art assets. */
export function editArt(doc: ProjectDoc, pageId: number, env: FlattenEnv, fn: (art: Artwork) => void): void {
  fn(ensureArt(doc, pageId));
  flattenPage(doc, pageId, env);
  pruneArtAssets(doc);
}

export function updateLayer(art: Artwork, id: string, fn: (l: Layer) => Layer): void {
  const i = art.layers.findIndex((l) => l.id === id);
  if (i < 0) throw new Error("layer not found");
  art.layers[i] = fn(art.layers[i]!);
}

export function removeLayer(art: Artwork, id: string): void {
  art.layers = art.layers.filter((l) => l.id !== id);
}

/** Move a layer up (+1, towards the top) or down. */
export function reorderLayer(art: Artwork, id: string, delta: number): void {
  const i = art.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const to = Math.max(0, Math.min(art.layers.length - 1, i + delta));
  const [l] = art.layers.splice(i, 1);
  art.layers.splice(to, 0, l!);
}

export function duplicateLayer(art: Artwork, id: string): string {
  const i = art.layers.findIndex((l) => l.id === id);
  if (i < 0) throw new Error("layer not found");
  const copy = { ...structuredClone(art.layers[i]!), id: layerId(), name: art.layers[i]!.name + " copy", locked: false };
  art.layers.splice(i + 1, 0, copy);
  return copy.id;
}

/** Remove art/ assets no page or font references any more. */
export function pruneArtAssets(doc: ProjectDoc): void {
  const used = new Set<string>([
    ...doc.project.pages.flatMap((p) => (p.art ? artAssets(p.art) : [])),
    ...(doc.project.artFonts ?? []).map((f) => f.asset),
  ]);
  for (const k of [...doc.assets.keys()]) if (k.startsWith("art/") && !used.has(k)) doc.assets.delete(k);
}

export function addArtFont(doc: ProjectDoc, family: string, data: Uint8Array): string {
  const clean = family.trim().replace(/["\\]/g, "") || "Font";
  const fonts = (doc.project.artFonts ??= []);
  let fam = clean;
  for (let k = 2; fonts.some((f) => f.family === fam); k++) fam = `${clean} ${k}`;
  const asset = `art/fonts/${layerId()}.ttf`;
  doc.assets.set(asset, data);
  fonts.push({ family: fam, asset });
  return fam;
}

/** A copy of the page for its pressed state (the picture DGUS shows while
 * a button is held: Pic_On). Optionally makes it Pic_On of the page's
 * touch areas that have none. Returns the new page. */
export function createPressedVariant(doc: ProjectDoc, pageId: number, link = true): Page {
  const src = getPage(doc, pageId);
  const id = freePageId(doc, pageId + 1);
  const name = `${src.name}_sel`;
  const page: Page = { id, name, background: null, touch: [], display: [] };
  if (src.background) {
    page.background = fileName("bitmap", id, name, "bmp");
    doc.assets.set(page.background, doc.assets.get(src.background)!);
  }
  if (src.art) {
    const art = structuredClone(src.art);
    art.layers = art.layers.map((l) => ({ ...l, id: layerId() }));
    page.art = art;
  }
  doc.project.pages.push(page);
  doc.project.pages.sort((a, b) => a.id - b.id);
  if (link) {
    for (const c of src.touch) {
      const e = fromHex(c.bytes);
      const h = readHead(e);
      if (h.picOn >> 8 === 0xff) c.bytes = hex(writeHead(e, { ...h, picOn: id }));
    }
  }
  return page;
}

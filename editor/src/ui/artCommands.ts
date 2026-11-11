// Picture-mode commands: every edit re-flattens the page's BMP inside the
// same undo step.
import { addArtFont, createPressedVariant, duplicateLayer, editArt, removeLayer, reorderLayer, updateLayer } from "../core/art/ops";
import { layerId, moveLayer, newLayer, type Artwork, type Layer, type LayerType } from "../core/art/schema";
import { Bitmap } from "../core/formats/bmp";
import { getPage } from "../core/project/ops";
import type { ProjectDoc } from "../core/project/schema";
import { T5UID1 } from "../core/profile/t5uid1";
import { cacheDecoded, envFor, loadFonts } from "./artEnv";
import { edit, getState, goPage, setState, type EditOptions } from "./store";

/** Edit the current page's artwork. Returns what `fn` returns. */
export function artEdit<T>(fn: (art: Artwork, doc: ProjectDoc) => T, opts: EditOptions = {}): T | undefined {
  const pageId = getState().pageId;
  if (pageId === null) return undefined;
  return edit((d) => {
    let out!: T;
    editArt(d, pageId, envFor(d), (a) => (out = fn(a, d)));
    return out;
  }, opts);
}

export function currentArt(): Artwork | null {
  const s = getState();
  if (!s.doc || s.pageId === null) return null;
  return s.doc.project.pages.find((p) => p.id === s.pageId)?.art ?? null;
}

export function currentLayer(): Layer | null {
  const id = getState().layerId;
  return currentArt()?.layers.find((l) => l.id === id) ?? null;
}

export function addLayer(type: LayerType, at?: { x: number; y: number; w?: number; h?: number }, opts: EditOptions = {}): string | undefined {
  const { w, h } = T5UID1.screen;
  const pos = at ?? { x: Math.round(w / 2 - 60), y: Math.round(h / 2 - 30) };
  const l = newLayer(type, pos);
  const id = artEdit((a) => (a.layers.push(l), l.id), opts);
  if (id) setState({ layerId: id });
  return id;
}

export function setLayer(id: string, fn: (l: Layer) => Layer, opts: EditOptions = {}): void {
  artEdit((a) => updateLayer(a, id, fn), opts);
}

/** Patch the selected layer's fields (typing in the panel coalesces). */
export function patchLayer(patch: Partial<Layer>, key?: string): void {
  const id = getState().layerId;
  if (!id) return;
  setLayer(id, (l) => ({ ...l, ...patch }) as Layer, key ? { coalesce: `layer:${id}:${key}` } : {});
}

export function deleteLayer(): void {
  const id = getState().layerId;
  if (!id) return;
  artEdit((a) => removeLayer(a, id));
  setState({ layerId: null });
}

export function duplicateSelectedLayer(): void {
  const id = getState().layerId;
  if (!id) return;
  const nu = artEdit((a) => duplicateLayer(a, id));
  if (nu) setState({ layerId: nu });
}

export function moveSelectedLayer(delta: number): void {
  const id = getState().layerId;
  if (id) artEdit((a) => reorderLayer(a, id, delta));
}

export function nudgeLayer(dx: number, dy: number): void {
  const l = currentLayer();
  if (!l || l.locked) return;
  setLayer(l.id, (x) => moveLayer(x, dx, dy), { coalesce: `nudge-layer:${l.id}`, quiet: true });
}

const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "png").toLowerCase();

/** Add an image file as a layer, fitted inside the screen. */
export async function addImageFile(file: File): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  const e = ext(file.name);
  let src: CanvasImageSource, iw: number, ih: number;
  try {
    if (e === "bmp") {
      const bm = Bitmap.load(data);
      iw = bm.w;
      ih = bm.h;
      src = await createImageBitmap(new ImageData(bm.toRGBA(), bm.w, bm.h));
    } else {
      const img = await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>], { type: file.type }));
      iw = img.width;
      ih = img.height;
      src = img;
    }
  } catch {
    alert(`Can't read ${file.name} as an image.`);
    return;
  }
  cacheDecoded(data, src);
  const { w, h } = T5UID1.screen;
  const k = Math.min(1, w / iw, h / ih);
  const lw = Math.max(1, Math.round(iw * k)), lh = Math.max(1, Math.round(ih * k));
  const key = `art/${layerId()}.${e}`;
  const layer: Layer = { ...newLayer("image", { x: Math.round((w - lw) / 2), y: Math.round((h - lh) / 2), w: lw, h: lh }),
    asset: key, name: file.name } as Layer;
  const id = artEdit((a, d) => {
    d.assets.set(key, data);
    a.layers.push(layer);
    return layer.id;
  });
  if (id) setState({ layerId: id });
}

/** Upload a TTF/OTF/WOFF font for text layers; returns its family. */
export async function uploadFont(file: File): Promise<string | undefined> {
  const data = new Uint8Array(await file.arrayBuffer());
  const family = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  const fam = edit((d) => addArtFont(d, family, data));
  const doc = getState().doc;
  if (fam && doc) await loadFonts(doc);
  return fam;
}

export function pressedVariant(link: boolean): void {
  const pageId = getState().pageId;
  if (pageId === null) return;
  const p = edit((d) => createPressedVariant(d, pageId, link));
  if (p) goPage(p.id);
}

/** Forget the layers but keep the picture as it is now. */
export function discardArt(): void {
  const pageId = getState().pageId;
  if (pageId === null) return;
  edit((d) => void delete getPage(d, pageId).art);
  setState({ layerId: null });
}

export function setArtSetting(patch: Partial<Pick<Artwork, "background" | "dither">>, key?: string): void {
  artEdit((a) => void Object.assign(a, patch), key ? { coalesce: `art:${key}` } : {});
}

export const toHex = (rgb: readonly number[]) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

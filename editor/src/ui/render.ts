// Canvas rendering of pages: background picture + icon previews. Decoded
// images are cached per asset array (assets are immutable).
import { Bitmap } from "../core/formats/bmp";
import { classify } from "../core/formats/dwinset";
import { IconLibrary } from "../core/formats/ico";
import { from565 } from "../core/formats/rgb565";
import type { ProjectDoc } from "../core/project/schema";

const bgCache = new WeakMap<Uint8Array, HTMLCanvasElement | null>();
const libCache = new WeakMap<Uint8Array, IconLibrary | null>();
const iconCache = new WeakMap<IconLibrary, Map<string, HTMLCanvasElement>>();

export function pictureCanvas(data: Uint8Array): HTMLCanvasElement | null {
  if (bgCache.has(data)) return bgCache.get(data)!;
  let c: HTMLCanvasElement | null = null;
  try {
    const bm = Bitmap.load(data);
    c = document.createElement("canvas");
    c.width = bm.w;
    c.height = bm.h;
    c.getContext("2d")?.putImageData(new ImageData(bm.toRGBA(), bm.w, bm.h), 0, 0);
  } catch {
    c = null;
  }
  bgCache.set(data, c);
  return c;
}

export function iconLibrary(doc: ProjectDoc, libId: number): IconLibrary | null {
  const f = doc.project.files.find((x) => x.kind === "icons" && classify(x.name).id === libId);
  const data = f && doc.assets.get(f.name);
  if (!data) return null;
  if (!libCache.has(data)) {
    let lib: IconLibrary | null = null;
    try {
      lib = IconLibrary.parse(data);
    } catch {
      lib = null;
    }
    libCache.set(data, lib);
  }
  return libCache.get(data)!;
}

export function iconSizeFn(doc: ProjectDoc) {
  return (lib: number, id: number): [number, number] | null => {
    const ic = iconLibrary(doc, lib)?.icons.get(id);
    return ic ? [ic.w, ic.h] : null;
  };
}

/** Icon as a canvas; black pixels transparent when `transparent`. */
export function iconCanvas(lib: IconLibrary, id: number, transparent: boolean): HTMLCanvasElement | null {
  const ic = lib.icons.get(id);
  if (!ic) return null;
  let m = iconCache.get(lib);
  if (!m) iconCache.set(lib, (m = new Map()));
  const key = `${id}/${transparent}`;
  let c = m.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = ic.w;
    c.height = ic.h;
    const img = new ImageData(ic.w, ic.h);
    for (let p = 0; p < ic.pixels.length; p++) {
      const v = ic.pixels[p]!;
      const [r, g, b] = from565(v);
      img.data.set([r, g, b, transparent && v === 0 ? 0 : 255], p * 4);
    }
    c.getContext("2d")?.putImageData(img, 0, 0);
    m.set(key, c);
  }
  return c;
}

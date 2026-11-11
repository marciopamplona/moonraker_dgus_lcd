// The browser side of artwork rendering: canvases, decoded images (cached
// per asset array; assets are immutable) and uploaded fonts.
import { bmpSource, type ArtEnv } from "../core/art/render";
import type { FlattenEnv as Env } from "../core/art/ops";
import { Bitmap } from "../core/formats/bmp";
import type { ProjectDoc } from "../core/project/schema";

type CanvasFactory = (w: number, h: number) => ReturnType<Env["canvas"]>;

let makeCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c as unknown as ReturnType<Env["canvas"]>;
};

/** The current canvas factory (for font rasterising too). */
export function canvasFactory(): CanvasFactory {
  return makeCanvas;
}

/** Tests swap in a Node canvas (happy-dom has none). */
export function setCanvasFactory(f: CanvasFactory): void {
  makeCanvas = f;
}

const decoded = new WeakMap<Uint8Array, CanvasImageSource>();

export function envFor(doc: ProjectDoc): ArtEnv & Env {
  const env: ArtEnv & Env = {
    canvas: (w, h) => makeCanvas(w, h),
    image(asset) {
      const data = doc.assets.get(asset);
      if (!data) return null;
      const hit = decoded.get(data);
      if (hit) return hit;
      if (/\.bmp$/i.test(asset)) {
        try {
          const src = bmpSource(env, data, Bitmap.load);
          decoded.set(data, src);
          return src;
        } catch {
          return null;
        }
      }
      return null; // other formats are decoded by loadImages() first
    },
  };
  return env;
}

/** Remember a decoded image for an asset array (after uploading it). */
export function cacheDecoded(data: Uint8Array, src: CanvasImageSource): void {
  decoded.set(data, src);
}

/** Decode PNG/JPG/GIF/WebP/SVG art assets (async) so renders can use them. */
export async function loadImages(doc: ProjectDoc): Promise<void> {
  for (const [key, data] of doc.assets) {
    if (!key.startsWith("art/") || /\.(bmp|ttf|otf|woff2?)$/i.test(key) || decoded.has(data)) continue;
    try {
      const type = /\.svg$/i.test(key) ? "image/svg+xml" : "";
      decoded.set(data, await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>], { type })));
    } catch {
      /* not an image this browser can decode */
    }
  }
}

const loadedFonts = new Map<string, Uint8Array>();

/** Register the project's uploaded fonts with the document. */
export async function loadFonts(doc: ProjectDoc): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return;
  for (const f of doc.project.artFonts ?? []) {
    const data = doc.assets.get(f.asset);
    if (!data || loadedFonts.get(f.family) === data) continue;
    try {
      const face = new FontFace(f.family, data.slice().buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      loadedFonts.set(f.family, data);
    } catch {
      /* unsupported font file */
    }
  }
}

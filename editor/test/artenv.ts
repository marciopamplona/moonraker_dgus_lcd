// An ArtEnv for tests, backed by @napi-rs/canvas (a real Canvas2D).
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { Bitmap, bmpSource, type FlattenEnv, type ProjectDoc } from "../src/core";
import { REPO } from "./util";

export function testEnv(doc: ProjectDoc): FlattenEnv & { preload(): Promise<void> } {
  const cache = new Map<string, CanvasImageSource>();
  const env: FlattenEnv & { preload(): Promise<void> } = {
    canvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<FlattenEnv["canvas"]>,
    image: (asset) => {
      if (cache.has(asset)) return cache.get(asset)!;
      const data = doc.assets.get(asset);
      if (data && asset.endsWith(".bmp")) {
        const src = bmpSource(env, data, Bitmap.load);
        cache.set(asset, src);
        return src;
      }
      return null;
    },
    async preload() {
      for (const [k, v] of doc.assets) {
        if (k.startsWith("art/") && /\.(png|jpe?g)$/i.test(k) && !cache.has(k)) {
          cache.set(k, (await loadImage(Buffer.from(v))) as unknown as CanvasImageSource);
        }
      }
    },
  };
  return env;
}

let fontDone = false;
export function registerTestFont(): string {
  if (!fontDone) {
    GlobalFonts.registerFromPath(`${REPO}/screen/fonts/selawk.ttf`, "Selawik");
    fontDone = true;
  }
  return "Selawik";
}

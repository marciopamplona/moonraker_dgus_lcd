// Turning user images (PNG, JPG, BMP, ...) into 24-bit page pictures.
import { Bitmap } from "../core/formats/bmp";

export type Fit = "stretch" | "cover" | "contain";

export async function imageToBitmap(file: Blob, w: number, h: number, fit: Fit = "cover"): Promise<Bitmap> {
  const img = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas not available");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  let dw = w, dh = h;
  if (fit !== "stretch") {
    const s = fit === "cover" ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
    dw = img.width * s;
    dh = img.height * s;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  img.close();
  return Bitmap.fromRGBA(w, h, ctx.getImageData(0, 0, w, h).data);
}

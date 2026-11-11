// Reading a DWIN_SET from a picked folder / dropped files / a zip, and
// writing one as a zip ready to unpack onto an SD card.
import { unzipSync, zipSync, type Zippable } from "fflate";
import { classify } from "../core/formats/dwinset";

/** Only files that belong in a DWIN_SET, by base name. If the input holds
 * a DWIN_SET folder, files outside it are ignored. */
export function pickDwinSet(entries: Iterable<[path: string, data: Uint8Array]>): Map<string, Uint8Array> {
  const all = [...entries].filter(([p]) => !p.endsWith("/"));
  const inSet = all.filter(([p]) => /(^|\/)DWIN_SET\//i.test(p));
  const use = inSet.length ? inSet : all;
  const out = new Map<string, Uint8Array>();
  for (const [path, data] of use) {
    const base = path.split("/").pop()!;
    if (base.startsWith(".")) continue;
    const kind = classify(base).kind;
    if (kind === "other" && !/\.(bin|bmp|ico|hzk|dzk|wav|lib|cfg)$/i.test(base)) continue;
    out.set(base, data);
  }
  return out;
}

export function unzipDwinSet(zip: Uint8Array): Map<string, Uint8Array> {
  return pickDwinSet(Object.entries(unzipSync(zip)));
}

export function zipDwinSet(files: Map<string, Uint8Array>, readme?: string): Uint8Array {
  const z: Zippable = {};
  for (const [name, data] of files) z[`DWIN_SET/${name}`] = [data, { level: 6 }];
  if (readme) z["FLASHING.txt"] = new TextEncoder().encode(readme);
  return zipSync(z);
}

export const FLASHING_README = `DWIN_SET exported by DGUS Studio

Flashing (T5UID1, e.g. the Ender-6 DMT48270C043_06WT)
  1. Format an SD card (max 32 GB) as FAT32 with 4096-byte clusters.
       Linux: sudo mkfs.vfat -F 32 -s 8 /dev/sdX1
  2. Copy the DWIN_SET folder to the root of the card.
  3. Power off, insert the card into the screen's slot and power on.
  4. Wait until the screen has finished (or shows "end"), power off,
     remove the card and power on again.
`;

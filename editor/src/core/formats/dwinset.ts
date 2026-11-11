// DWIN_SET file naming: "<id>[_name].<ext>". The id is the picture number
// for .bmp (and .jpg on T5L), the 256 KB NAND block for .bin/.hzk/.dzk/.ico,
// and the audio id for .wav. T5UID1.CFG has no id.

export type DwinFileKind = "bitmap" | "touch" | "variables" | "sraminit" | "icons" | "font" | "audio" | "config" | "bin" | "other";

export interface DwinFileName {
  name: string; // original file name
  id: number | null;
  label: string; // the part after "<id>_", without extension
  ext: string; // lower case, no dot
  kind: DwinFileKind;
}

const RE = /^(\d+)(?:[_ -]?(.*))?\.([A-Za-z0-9]+)$/;

export function classify(name: string): DwinFileName {
  const base = name.split(/[\\/]/).pop() ?? name;
  const ext = (base.split(".").pop() ?? "").toLowerCase();
  if (/^T5.*\.CFG$/i.test(base)) return { name: base, id: null, label: base, ext, kind: "config" };
  const m = RE.exec(base);
  if (!m) return { name: base, id: null, label: base, ext, kind: "other" };
  const id = parseInt(m[1]!, 10);
  const label = m[2] ?? "";
  let kind: DwinFileKind = "other";
  if (ext === "bmp") kind = "bitmap";
  else if (ext === "ico") kind = "icons";
  else if (ext === "hzk" || ext === "dzk") kind = "font";
  else if (ext === "wav") kind = "audio";
  else if (ext === "bin") kind = id === 13 ? "touch" : id === 14 ? "variables" : id === 22 ? "sraminit" : "bin";
  return { name: base, id, label, ext, kind };
}

/** "<id padded>_<label>.<ext>", padding like DGUS-reloaded (3 digits for
 * pictures, none otherwise). */
export function fileName(kind: DwinFileKind, id: number, label: string, ext: string): string {
  const num = kind === "bitmap" ? String(id).padStart(3, "0") : String(id);
  const safe = label.replace(/[^A-Za-z0-9_-]+/g, "_");
  return safe ? `${num}_${safe}.${ext}` : `${num}.${ext}`;
}

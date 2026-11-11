// Project files that aren't pages: icon libraries, fonts, audio, CFG,
// 22*.BIN and other binaries.
import { fromHex, hex } from "../bytes";
import { fieldSpecs, readField, writeField } from "../controls/describe";
import { decodeCfg, defaultCfgBytes, encodeCfg, type T5uid1Config } from "../formats/cfg";
import { SramInit, type InitRun } from "../formats/config22";
import { classify, fileName, type DwinFileKind } from "../formats/dwinset";
import { ASCII_LIB_SIZE, AsciiFontLib } from "../formats/hzk";
import { IconLibrary, type Icon } from "../formats/ico";
import { to565 } from "../formats/rgb565";
import { checkCfg } from "../formats/cfg";
import { T5UID1 } from "../profile/t5uid1";
import type { ProjectDoc, ProjectFile } from "../project/schema";

const MANAGED: DwinFileKind[] = ["touch", "variables", "bitmap"];

export function getFile(doc: ProjectDoc, name: string): ProjectFile {
  const f = doc.project.files.find((x) => x.name === name);
  if (!f) throw new Error(`no file ${name}`);
  return f;
}

function allNames(doc: ProjectDoc): Set<string> {
  return new Set([
    ...doc.project.files.map((f) => f.name.toLowerCase()),
    ...doc.project.pages.flatMap((p) => (p.background ? [p.background.toLowerCase()] : [])),
    doc.project.touchFile.toLowerCase(), doc.project.variables.file.toLowerCase(),
  ]);
}

/** Throws if `data` isn't a valid file of `kind`. */
export function validateFile(name: string, data: Uint8Array): void {
  const f = classify(name);
  switch (f.kind) {
    case "icons": IconLibrary.parse(data); break;
    case "config": checkCfg(data); break;
    case "sraminit": if (data.length % 2) throw new Error("22*.BIN must have an even length"); break;
    case "font": if (f.id === 0 && data.length !== ASCII_LIB_SIZE) throw new Error("0_*.HZK must be a full ASCII library"); break;
    case "audio": if (String.fromCharCode(...data.subarray(0, 4)) !== "RIFF") throw new Error("not a WAV file"); break;
  }
}

export function addFile(doc: ProjectDoc, name: string, data: Uint8Array): ProjectFile {
  const f = classify(name);
  if (MANAGED.includes(f.kind)) {
    throw new Error(f.kind === "bitmap" ? "Pictures are pages: add a page and replace its picture" : `${name} is built from the pages`);
  }
  if (f.kind === "other") throw new Error(`${name}: not a DWIN_SET file name (<id>_name.bin/.ico/.hzk/.dzk/.wav or T5UID1.CFG)`);
  if (allNames(doc).has(f.name.toLowerCase())) throw new Error(`${f.name} exists`);
  validateFile(f.name, data);
  const file: ProjectFile = { name: f.name, kind: f.kind };
  doc.assets.set(f.name, data);
  doc.project.files.push(file);
  doc.project.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return file;
}

export function replaceFile(doc: ProjectDoc, name: string, data: Uint8Array): void {
  getFile(doc, name);
  validateFile(name, data);
  doc.assets.set(name, data);
}

export function deleteFile(doc: ProjectDoc, name: string): void {
  getFile(doc, name);
  doc.project.files = doc.project.files.filter((f) => f.name !== name);
  doc.assets.delete(name);
}

/** Every control field that names a font-space file id (icon libraries and
 * fonts share the id space). */
function libFields(doc: ProjectDoc) {
  const out: { kind: "touch" | "display"; c: { bytes: string }; off: number }[] = [];
  for (const pg of doc.project.pages) {
    for (const kind of ["touch", "display"] as const) {
      for (const c of pg[kind]) {
        for (const s of fieldSpecs(kind, fromHex(c.bytes))) if (s.fmt === "lib") out.push({ kind, c, off: s.off });
      }
    }
  }
  return out;
}

export function countLibRefs(doc: ProjectDoc, id: number): number {
  return libFields(doc).filter((r) => {
    const e = fromHex(r.c.bytes);
    return readField(e, fieldSpecs(r.kind, e).find((s) => s.off === r.off)!) === id;
  }).length;
}

/** Rename a file (new id and/or label). Changing the id of an icon library
 * or font updates the controls that use it. Returns the new name and the
 * number of references changed. */
export function renameFile(doc: ProjectDoc, name: string, id: number, label: string): { name: string; refs: number } {
  const file = getFile(doc, name);
  const f = classify(name);
  if (f.id === null) throw new Error(`${name} has no id`);
  if (id < 0 || id > 255) throw new Error("id must be 0-255");
  const next = fileName(f.kind, id, label, f.ext);
  if (next.toLowerCase() !== name.toLowerCase() && allNames(doc).has(next.toLowerCase())) throw new Error(`${next} exists`);
  let refs = 0;
  if (id !== f.id && (f.kind === "icons" || f.kind === "font")) {
    for (const r of libFields(doc)) {
      const e = fromHex(r.c.bytes);
      const s = fieldSpecs(r.kind, e).find((x) => x.off === r.off)!;
      if (readField(e, s) === f.id) {
        r.c.bytes = hex(writeField(e, s, id));
        refs++;
      }
    }
  }
  const data = doc.assets.get(name)!;
  doc.assets.delete(name);
  doc.assets.set(next, data);
  file.name = next;
  doc.project.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { name: next, refs };
}

// --- icon libraries ------------------------------------------------------------

export function newIconLibrary(doc: ProjectDoc, id: number, label: string): ProjectFile {
  return addFile(doc, fileName("icons", id, label || "icons", "ico"), new IconLibrary().build());
}

function editIcons(doc: ProjectDoc, name: string, fn: (lib: IconLibrary) => void): void {
  const lib = IconLibrary.parse(doc.assets.get(getFile(doc, name).name)!);
  fn(lib);
  doc.assets.set(name, lib.build());
}

export function setIcons(doc: ProjectDoc, name: string, icons: [number, Icon][]): void {
  editIcons(doc, name, (lib) => icons.forEach(([id, ic]) => lib.set(id, ic)));
}

export function deleteIcon(doc: ProjectDoc, name: string, id: number): void {
  editIcons(doc, name, (lib) => lib.delete(id));
}

export function moveIcon(doc: ProjectDoc, name: string, from: number, to: number): void {
  editIcons(doc, name, (lib) => {
    const ic = lib.icons.get(from);
    if (!ic) throw new Error(`no icon ${from}`);
    if (lib.icons.has(to)) throw new Error(`icon ${to} exists`);
    lib.delete(from);
    lib.set(to, ic);
  });
}

/** How many display variables show each icon of library `libId`. Ranges
 * (variable icon min..max, bit icon start..end) count every icon in them. */
export function iconUsage(doc: ProjectDoc, libId: number): Map<number, number> {
  const out = new Map<number, number>();
  const add = (a: number, b = a) => {
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 1024; i++) out.set(i, (out.get(i) ?? 0) + 1);
  };
  for (const pg of doc.project.pages) {
    for (const c of pg.display) {
      const e = fromHex(c.bytes);
      const specs = fieldSpecs("display", e);
      const get = (n: string) => { const s = specs.find((x) => x.name === n); return s ? readField(e, s) : null; };
      const lib = get("Icon_Lib") ?? get("Lib_ID");
      if (lib !== libId) continue;
      switch (e[1]) {
        case 0x00: add(get("Icon_Min")!, get("Icon_Max")!); break;
        case 0x01: add(get("Icon_Stop")!); add(get("Icon_Start")!, get("Icon_End")!); break;
        case 0x06: add(get("ICON0S")!, get("ICON0E")!); add(get("ICON1S")!, get("ICON1E")!); break;
        case 0x03: add(get("Icon0")!, get("Icon0")! + 12); break;
        default: for (const s of specs) if (s.fmt === "icon") add(readField(e, s));
      }
    }
  }
  return out;
}

export interface IconImportOptions {
  /** Transparent pixels become black (0x0000), which the screen leaves
   * out when an icon is drawn in transparent mode; opaque pure black is
   * nudged to 0x0020 so it stays visible. */
  transparency: boolean;
}

/** RGBA pixels -> icon (at most 255 x 255). */
export function iconFromRGBA(w: number, h: number, rgba: ArrayLike<number>, o: IconImportOptions = { transparency: true }): Icon {
  if (w < 1 || h < 1 || w > 255 || h > 255) throw new Error(`icons must be 1-255 px (got ${w}x${h})`);
  const pixels = new Uint16Array(w * h);
  for (let p = 0; p < pixels.length; p++) {
    const a = rgba[p * 4 + 3]!;
    let v = to565(rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!);
    if (o.transparency) {
      if (a < 128) v = 0;
      else if (v === 0) v = 0x0020;
    }
    pixels[p] = v;
  }
  return { w, h, pixels };
}

/** Icon id from a file name like "12.png" or "12_name.bmp", or null. */
export function iconIdFromName(name: string): number | null {
  const m = /^(\d+)/.exec(name.split(/[\\/]/).pop() ?? "");
  return m ? parseInt(m[1]!, 10) : null;
}

// --- fonts ---------------------------------------------------------------------

export function isAsciiLib(data: Uint8Array | undefined): boolean {
  return !!data && data.length === ASCII_LIB_SIZE;
}

/** A new ASCII font library file: a copy of `base` (e.g. 0_DWIN_ASC so
 * characters you don't generate keep their defaults) or empty. */
export function newAsciiFont(doc: ProjectDoc, id: number, label: string, base?: Uint8Array): ProjectFile {
  return addFile(doc, fileName("font", id, label || "font", "hzk"), new AsciiFontLib(base).build());
}

// --- CFG and 22*.BIN -------------------------------------------------------------

export function cfgFile(doc: ProjectDoc): ProjectFile | undefined {
  return doc.project.files.find((f) => f.kind === "config");
}

export function setCfg(doc: ProjectDoc, cfg: T5uid1Config): void {
  const f = cfgFile(doc) ?? addFile(doc, T5UID1.cfgName, defaultCfgBytes());
  doc.assets.set(f.name, encodeCfg(cfg, doc.assets.get(f.name)!));
}

export function getCfg(doc: ProjectDoc): T5uid1Config | null {
  const f = cfgFile(doc);
  return f ? decodeCfg(doc.assets.get(f.name)!) : null;
}

export function sramFile(doc: ProjectDoc): ProjectFile | undefined {
  return doc.project.files.find((f) => f.kind === "sraminit");
}

export function setSramRuns(doc: ProjectDoc, runs: InitRun[]): void {
  const f = sramFile(doc) ?? addFile(doc, "22_config.bin", new SramInit().build());
  const size = doc.assets.get(f.name)!.length;
  for (const r of runs) {
    if (r.vp < 0 || (r.vp + r.words.length) * 2 > size) throw new Error(`VP 0x${r.vp.toString(16)} is outside 22.bin`);
  }
  doc.assets.set(f.name, SramInit.fromRuns(runs, size).build());
}

/** Text -> big-endian words (two bytes per word), as text variables read. */
export function textWords(text: string): number[] {
  const b = Array.from(new TextEncoder().encode(text));
  const out: number[] = [];
  for (let i = 0; i < b.length; i += 2) out.push((b[i]! << 8) | (b[i + 1] ?? 0));
  return out;
}

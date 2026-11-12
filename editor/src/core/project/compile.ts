// ProjectDoc -> DWIN_SET files.
import { FormatError, fromHex } from "../bytes";
import { fieldSpecs, readField } from "../controls/describe";
import { TouchFile } from "../formats/touch13";
import { VariableFile } from "../formats/var14";
import type { ProjectDoc } from "./schema";

export function compile(doc: ProjectDoc): Map<string, Uint8Array> {
  const { project: p, assets } = doc;
  const out = new Map<string, Uint8Array>();
  const asset = (key: string) => {
    const a = assets.get(key);
    if (!a) throw new FormatError(`missing asset ${key}`);
    return a;
  };
  const add = (name: string, data: Uint8Array) => {
    if (out.has(name)) throw new FormatError(`two files named ${name}`);
    out.set(name, data);
  };
  const pages = [...p.pages].sort((a, b) => a.id - b.id);
  for (const pg of pages) if (pg.background) add(pg.background, asset(pg.background));

  const touch = new TouchFile();
  for (const pg of pages) for (const c of pg.touch) touch.entries.push(fromHex(c.bytes));
  add(p.touchFile, touch.build());

  const vars = new VariableFile(fromHex(p.variables.header), new Map(), fromHex(p.variables.trailer));
  for (const pg of pages) for (const c of pg.display) vars.add(pg.id, fromHex(c.bytes));
  add(p.variables.file, vars.build());

  for (const f of p.files) add(f.name, asset(f.name));
  return out;
}

/** Pages whose pictures page `id` shows besides its own: pressed-state
 * pictures (Pic_On), keypad pages and popup menus (not Pic_Next jumps). */
export function pagePictureRefs(doc: ProjectDoc, id: number): number[] {
  const page = doc.project.pages.find((p) => p.id === id);
  if (!page) throw new FormatError(`no page ${id}`);
  const out = new Set<number>();
  for (const kind of ["touch", "display"] as const) {
    for (const c of page[kind]) {
      const e = fromHex(c.bytes);
      for (const s of fieldSpecs(kind, e)) {
        if (s.fmt !== "page" || s.name === "Page" || s.name === "Pic_Next") continue;
        const v = readField(e, s);
        if (v >> 8 !== 0xff && v !== id) out.add(v);
      }
    }
  }
  return [...out].filter((p) => doc.project.pages.some((x) => x.id === p)).sort((a, b) => a - b);
}

/** Files to flash for one page: its picture, the touch and variable files
 * (they hold every page's controls), and optionally the pictures of the
 * pages it shows (see pagePictureRefs). */
export function pageFileNames(doc: ProjectDoc, id: number, withRefs = true): string[] {
  const pages = [id, ...(withRefs ? pagePictureRefs(doc, id) : [])];
  const pics = pages.flatMap((p) => doc.project.pages.find((x) => x.id === p)?.background ?? []);
  return [...pics, doc.project.touchFile, doc.project.variables.file];
}

// File-level commands (add, rename, delete, new icon library / font).
import { ASCII_LIB_SIZE } from "../core/formats/hzk";
import { addFile, newAsciiFont, newIconLibrary, renameFile, replaceFile, deleteFile } from "../core/files/ops";
import { freeFontId, nandUses } from "../core/files/nand";
import { IconLibrary } from "../core/formats/ico";
import { edit, getState, openFile } from "./store";

export async function addFiles(files: FileList | File[]): Promise<void> {
  const errors: string[] = [];
  const read = await Promise.all(Array.from(files).map(async (f) => [f.name, new Uint8Array(await f.arrayBuffer())] as const));
  let last: string | null = null;
  edit((d) => {
    for (const [name, data] of read) {
      try {
        last = addFile(d, name, data).name;
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }, { quiet: true });
  if (errors.length) alert(errors.join("\n"));
  if (last) openFile(last);
}

export function newIcons(): void {
  const doc = getState().doc;
  if (!doc) return;
  const id = freeFontId(nandUses(doc), new IconLibrary().build().length);
  const f = edit((d) => newIconLibrary(d, id, "icons"));
  if (f) openFile(f.name);
}

export function newFont(): void {
  const doc = getState().doc;
  if (!doc) return;
  const id = freeFontId(nandUses(doc), ASCII_LIB_SIZE);
  const base = doc.project.files.find((f) => f.kind === "font" && /^0[_.]/.test(f.name));
  const f = edit((d) => newAsciiFont(d, id, "font", base ? d.assets.get(base.name) : undefined));
  if (f) openFile(f.name);
}

export function rename(name: string, id: number, label: string): void {
  const r = edit((d) => renameFile(d, name, id, label));
  if (r) openFile(r.name);
}

export async function replaceWith(name: string, file: File): Promise<void> {
  const data = new Uint8Array(await file.arrayBuffer());
  edit((d) => replaceFile(d, name, data));
}

export function remove(name: string): void {
  if (edit((d) => (deleteFile(d, name), true))) openFile(null);
}

export function download(data: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

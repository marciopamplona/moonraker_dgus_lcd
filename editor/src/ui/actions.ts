// Opening, importing, saving and exporting projects.
import { compile } from "../core/project/compile";
import { decompile } from "../core/project/decompile";
import { blankProject } from "../core/project/blank";
import { DGUSPROJ_EXT, loadDgusproj, saveDgusproj } from "../io/dgusproj";
import { FLASHING_README, pickDwinSet, unzipDwinSet, zipDwinSet } from "../io/dwinset";
import * as idb from "../io/idb";
import { flushSave, getState, openDoc, setState } from "./store";

export function toast(message: string): void {
  setState({ warnings: [message, ...getState().warnings] });
}

function fail(e: unknown): void {
  alert(e instanceof Error ? e.message : String(e));
}

async function readAll(files: Iterable<File>, pathOf: (f: File) => string): Promise<[string, Uint8Array][]> {
  const out: [string, Uint8Array][] = [];
  for (const f of files) out.push([pathOf(f), new Uint8Array(await f.arrayBuffer())]);
  return out;
}

export async function newBlank(): Promise<void> {
  await flushSave();
  openDoc(blankProject());
}

function importSet(files: Map<string, Uint8Array>, name: string): void {
  if (!files.size) throw new Error("no DWIN_SET files found");
  const { doc, warnings } = decompile(files, name);
  openDoc(doc, warnings);
}

/** Files from <input webkitdirectory>. */
export async function importFolder(list: FileList | File[]): Promise<void> {
  try {
    await flushSave();
    const files = Array.from(list);
    const entries = await readAll(files, (f) => f.webkitRelativePath || f.name);
    const root = (files[0]?.webkitRelativePath || "").split("/")[0] || "Imported project";
    importSet(pickDwinSet(entries), root === "DWIN_SET" ? "Imported project" : root);
  } catch (e) {
    fail(e);
  }
}

/** A single file: .dgusproj, or a .zip holding a DWIN_SET. */
export async function openFile(file: File): Promise<void> {
  try {
    await flushSave();
    const data = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(DGUSPROJ_EXT)) {
      const doc = loadDgusproj(data);
      if (idb.available()) {
        const existing = (await idb.listProjects()).find((p) => p.id === doc.project.id);
        if (existing && existing.modified > doc.project.modified &&
          !confirm(`"${existing.name}" in browser storage is newer than this file. Replace it with the file?`)) {
          const stored = await idb.loadProject(existing.id);
          if (stored) return openDoc(stored, [], false);
        }
      }
      openDoc(doc);
    } else {
      importSet(unzipDwinSet(data), file.name.replace(/\.zip$/i, ""));
    }
  } catch (e) {
    fail(e);
  }
}

/** Dropped items: folders are walked. */
export async function importDropped(dt: DataTransfer): Promise<void> {
  const items = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (items.length === 1 && items[0]!.isFile) {
    const f = dt.files[0];
    if (f) return openFile(f);
  }
  try {
    await flushSave();
    const entries: [string, Uint8Array][] = [];
    const walk = async (e: FileSystemEntry): Promise<void> => {
      if (e.isFile) {
        const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
        entries.push([e.fullPath.replace(/^\//, ""), new Uint8Array(await f.arrayBuffer())]);
      } else if (e.isDirectory) {
        const reader = (e as FileSystemDirectoryEntry).createReader();
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          for (const c of batch) await walk(c);
        }
      }
    };
    for (const e of items) await walk(e);
    const name = items[0]?.isDirectory && items[0].name !== "DWIN_SET" ? items[0].name : "Imported project";
    importSet(pickDwinSet(entries), name);
  } catch (e) {
    fail(e);
  }
}

export async function openStored(id: string): Promise<void> {
  try {
    await flushSave();
    const doc = await idb.loadProject(id);
    if (!doc) throw new Error("project not found in browser storage");
    openDoc(doc, [], false);
  } catch (e) {
    fail(e);
  }
}

function download(data: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "project";

export function saveFile(): void {
  const doc = getState().doc;
  if (doc) download(saveDgusproj(doc), safeName(doc.project.name) + DGUSPROJ_EXT);
}

export function exportDwinSet(): void {
  const doc = getState().doc;
  if (!doc) return;
  try {
    download(zipDwinSet(compile(doc), FLASHING_README), safeName(doc.project.name) + "_DWIN_SET.zip");
  } catch (e) {
    fail(e);
  }
}

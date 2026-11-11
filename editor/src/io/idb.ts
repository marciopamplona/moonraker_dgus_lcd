// Browser storage for projects (IndexedDB). Lives only in this browser
// profile; nothing leaves the machine.
//
//   projects: { id, name, modified, project (JSON), assets: {key: blobId} }
//   blobs:    blobId -> Uint8Array
//
// Assets are immutable Uint8Arrays (an edit replaces the array), so each
// array gets a blob id once and is only written once; autosave then just
// rewrites the small project record.
import type { Project, ProjectDoc } from "../core/project/schema";

const DB_NAME = "dgus-studio";
const DB_VERSION = 1;

export interface ProjectSummary {
  id: string;
  name: string;
  modified: string;
  pages: number;
}

interface ProjectRecord {
  id: string;
  name: string;
  modified: string;
  project: Project;
  assets: Record<string, string>;
}

const blobIds = new WeakMap<Uint8Array, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export function available(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        dbPromise = null;
        reject(r.error);
      };
    });
  }
  return dbPromise;
}

function blobId(): string {
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Ask the browser not to evict our storage (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  const db = await open();
  const tx = db.transaction(["projects", "blobs"], "readwrite");
  const projects = tx.objectStore("projects");
  const blobs = tx.objectStore("blobs");
  const prev = (await req(projects.get(doc.project.id))) as ProjectRecord | undefined;
  const assets: Record<string, string> = {};
  const fresh: Uint8Array[] = [];
  for (const [key, data] of doc.assets) {
    let id = blobIds.get(data);
    if (!id) {
      id = blobId();
      blobs.put(data, id);
      fresh.push(data);
      blobIds.set(data, id);
    }
    assets[key] = id;
  }
  const used = new Set(Object.values(assets));
  for (const id of Object.values(prev?.assets ?? {})) if (!used.has(id)) blobs.delete(id);
  const rec: ProjectRecord = {
    id: doc.project.id, name: doc.project.name, modified: doc.project.modified,
    project: doc.project, assets,
  };
  projects.put(rec);
  try {
    await done(tx);
  } catch (e) {
    for (const d of fresh) blobIds.delete(d);
    throw e;
  }
}

export async function loadProject(id: string): Promise<ProjectDoc | null> {
  const db = await open();
  const tx = db.transaction(["projects", "blobs"], "readonly");
  const rec = (await req(tx.objectStore("projects").get(id))) as ProjectRecord | undefined;
  if (!rec) return null;
  const blobs = tx.objectStore("blobs");
  const assets = new Map<string, Uint8Array>();
  for (const [key, bid] of Object.entries(rec.assets)) {
    const data = (await req(blobs.get(bid))) as Uint8Array | undefined;
    if (!data) throw new Error(`stored asset ${key} is missing`);
    blobIds.set(data, bid);
    assets.set(key, data);
  }
  return { project: rec.project, assets };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await open();
  const recs = (await req(db.transaction("projects").objectStore("projects").getAll())) as ProjectRecord[];
  return recs
    .map((r) => ({ id: r.id, name: r.name, modified: r.modified, pages: r.project.pages.length }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(["projects", "blobs"], "readwrite");
  const projects = tx.objectStore("projects");
  const rec = (await req(projects.get(id))) as ProjectRecord | undefined;
  if (rec) {
    for (const bid of Object.values(rec.assets)) tx.objectStore("blobs").delete(bid);
    projects.delete(id);
  }
  await done(tx);
}

/** For tests: forget the cached connection. */
export function _reset(): void {
  dbPromise?.then((db) => db.close());
  dbPromise = null;
}

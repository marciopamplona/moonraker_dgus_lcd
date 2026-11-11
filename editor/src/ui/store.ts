// App state with subscribe; autosaves the open project to IndexedDB.
import { useEffect, useState } from "preact/hooks";
import { now, type ProjectDoc } from "../core/project/schema";
import * as idb from "../io/idb";

export type SaveState = "off" | "idle" | "pending" | "saving" | "saved" | "error";

export interface Selection {
  kind: "touch" | "display";
  uid: string;
}

export interface State {
  doc: ProjectDoc | null;
  pageId: number | null;
  selection: Selection | null;
  warnings: string[];
  save: SaveState;
  saveError: string;
  layers: { touch: boolean; display: boolean; icons: boolean };
  zoom: number;
}

let state: State = {
  doc: null, pageId: null, selection: null, warnings: [],
  save: idb.available() ? "idle" : "off", saveError: "",
  layers: { touch: true, display: true, icons: true }, zoom: 2,
};
const subs = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return state;
}

// --- autosave ----------------------------------------------------------------
const AUTOSAVE_MS = 800;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

function scheduleSave(): void {
  if (state.save === "off" || !state.doc) return;
  if (timer) clearTimeout(timer);
  setState({ save: "pending" });
  timer = setTimeout(() => void flushSave(), AUTOSAVE_MS);
}

export async function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const doc = state.doc;
  if (!doc || state.save === "off") return;
  if (saving) await saving;
  setState({ save: "saving" });
  saving = idb.saveProject(doc)
    .then(() => setState({ save: "saved", saveError: "" }))
    .catch((e: unknown) => setState({ save: "error", saveError: e instanceof Error ? e.message : String(e) }))
    .finally(() => (saving = null));
  await saving;
}

/** Open a project (imported, loaded, or new) and store it. */
export function openDoc(doc: ProjectDoc, warnings: string[] = [], persist = true): void {
  setState({
    doc, warnings, selection: null,
    pageId: doc.project.pages[0]?.id ?? null,
  });
  if (persist) {
    void idb.requestPersistence();
    scheduleSave();
  }
}

export function closeDoc(): void {
  void flushSave().then(() => setState({ doc: null, pageId: null, selection: null, warnings: [] }));
}

/** Apply an edit to the open project; bumps `modified` and autosaves. */
export function edit(fn: (doc: ProjectDoc) => void): void {
  const doc = state.doc;
  if (!doc) return;
  const next: ProjectDoc = { project: structuredClone(doc.project), assets: new Map(doc.assets) };
  fn(next);
  next.project.modified = now();
  setState({ doc: next });
  scheduleSave();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (state.save === "pending" || state.save === "saving") {
      void flushSave();
      e.preventDefault();
    }
  });
}

// App state with subscribe; autosaves the open project to IndexedDB.
import { useEffect, useState } from "preact/hooks";
import { findControl } from "../core/project/ops";
import { now, type ProjectDoc } from "../core/project/schema";
import { hostRules } from "../core/sim/host";
import { Simulator } from "../core/sim/simulator";
import * as idb from "../io/idb";
import { loadFonts, loadImages } from "./artEnv";

export type SaveState = "off" | "idle" | "pending" | "saving" | "saved" | "error";

export interface Selection {
  kind: "touch" | "display";
  uid: string;
}

export type ArtTool = "select" | "rect" | "ellipse" | "line" | "text" | "brush" | "eraser" | "eyedropper";

export interface State {
  doc: ProjectDoc | null;
  pageId: number | null;
  selection: Selection | null;
  warnings: string[];
  save: SaveState;
  saveError: string;
  layers: { touch: boolean; display: boolean; icons: boolean };
  zoom: number;
  /** Undo / redo stacks of whole documents (assets are shared, not copied). */
  past: ProjectDoc[];
  future: ProjectDoc[];
  mode: "edit" | "picture" | "simulate";
  /** Picture mode: selected layer, tool and brush. */
  layerId: string | null;
  tool: ArtTool;
  brush: { color: string; width: number };
  /** Show page pictures as the screen will (RGB565). */
  preview565: boolean;
  /** A project file open in the main area instead of a page. */
  file: string | null;
  panel: "inspect" | "vps";
  sim: Simulator;
  /** Bumped when the simulator's state changes. */
  simTick: number;
}

let state: State = {
  doc: null, pageId: null, selection: null, warnings: [],
  save: idb.available() ? "idle" : "off", saveError: "",
  layers: { touch: true, display: true, icons: true }, zoom: 2,
  past: [], future: [], mode: "edit", panel: "inspect", sim: new Simulator(0), simTick: 0,
  layerId: null, tool: "select", brush: { color: "#ffffff", width: 6 }, preview565: false, file: null,
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
  const pageId = doc.project.pages[0]?.id ?? null;
  setState({
    doc, warnings, selection: null, pageId, past: [], future: [], mode: "edit", layerId: null, tool: "select", file: null,
    sim: makeSim(doc, pageId ?? 0), simTick: 0,
  });
  // decode layer images and register uploaded fonts, then redraw
  void Promise.all([loadImages(doc), loadFonts(doc)]).then(() => state.doc === doc && setState({}));
  if (persist) {
    void idb.requestPersistence();
    scheduleSave();
  }
}

export function closeDoc(): void {
  void flushSave().then(() => setState({ doc: null, pageId: null, selection: null, warnings: [] }));
}

const HISTORY = 100;
const COALESCE_MS = 1500;
let lastKey: string | null = null;
let lastTime = 0;

export interface EditOptions {
  /** Edits with the same key in quick succession (a drag, typing) become
   * one undo step. */
  coalesce?: string;
  /** Don't show errors (used while dragging). */
  quiet?: boolean;
}

/** Apply an edit to a copy of the open project. Returns false (and leaves
 * the project unchanged) when `fn` throws. Bumps `modified`, records undo
 * history and autosaves. */
export function edit<T>(fn: (doc: ProjectDoc) => T, opts: EditOptions = {}): T | undefined {
  const doc = state.doc;
  if (!doc) return undefined;
  const next: ProjectDoc = { project: structuredClone(doc.project), assets: new Map(doc.assets) };
  let result: T;
  try {
    result = fn(next);
  } catch (e) {
    if (!opts.quiet) alert(e instanceof Error ? e.message : String(e));
    return undefined;
  }
  next.project.modified = now();
  const t = Date.now();
  const merge = opts.coalesce !== undefined && opts.coalesce === lastKey && t - lastTime < COALESCE_MS;
  lastKey = opts.coalesce ?? null;
  lastTime = t;
  setState({
    doc: next,
    past: merge ? state.past : [...state.past, doc].slice(-HISTORY),
    future: [],
    ...fixView(next),
  });
  scheduleSave();
  return result;
}

/** Keep the current page and selection valid for `doc`. */
function fixView(doc: ProjectDoc): Partial<State> {
  const out: Partial<State> = {};
  if (!doc.project.pages.some((p) => p.id === state.pageId)) out.pageId = doc.project.pages[0]?.id ?? null;
  if (state.selection && !findControl(doc, state.selection.uid)) out.selection = null;
  if (state.file && !doc.project.files.some((f) => f.name === state.file)) out.file = null;
  return out;
}

/** End the current coalescing group (e.g. on pointer up). */
export function endGroup(): void {
  lastKey = null;
}

export function undo(): void {
  const prev = state.past.at(-1);
  if (!state.doc || !prev) return;
  lastKey = null;
  setState({ doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future], ...fixView(prev) });
  scheduleSave();
}

export function redo(): void {
  const next = state.future[0];
  if (!state.doc || !next) return;
  lastKey = null;
  setState({ doc: next, past: [...state.past, state.doc], future: state.future.slice(1), ...fixView(next) });
  scheduleSave();
}

export function goPage(id: number): void {
  state.sim.page = id;
  state.sim.closeOverlay();
  setState({ pageId: id, selection: null, layerId: null, file: null });
}

export function openFile(name: string | null): void {
  setState({ file: name, selection: null, layerId: null, ...(name && state.mode !== "edit" ? { mode: "edit" } : {}) });
}

export function simChanged(): void {
  setState({ simTick: state.simTick + 1, ...(state.sim.page !== state.pageId ? { pageId: state.sim.page } : {}) });
}

function makeSim(doc: ProjectDoc | null, page: number): Simulator {
  const sim = new Simulator(page, doc ? hostRules(doc).rules : []);
  if (doc) sim.setProject(doc.project.pages);
  return sim;
}

export function resetSim(): void {
  setState({ sim: makeSim(state.doc, state.pageId ?? 0), simTick: state.simTick + 1 });
}

/** Keep the simulator's rules and page list in step with the project. */
export function syncSim(): Simulator {
  const { sim, doc } = state;
  if (doc) {
    sim.rules = hostRules(doc).rules;
    sim.setProject(doc.project.pages);
  }
  return sim;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (state.save === "pending" || state.save === "saving") {
      void flushSave();
      e.preventDefault();
    }
  });
}

// Editor commands shared by the toolbar and keyboard shortcuts.
import { fromHex } from "../core/bytes";
import { moveBy } from "../core/controls/geometry";
import { TEMPLATES, template } from "../core/controls/templates";
import { addControl, addPage, deleteControl, duplicateControl, findControl, updateControl } from "../core/project/ops";
import { allocVp } from "../core/project/vp";
import { T5UID1 } from "../core/profile/t5uid1";
import { deleteLayer, duplicateSelectedLayer, nudgeLayer } from "./artCommands";
import { edit, getState, goPage, redo, setState, undo, type ArtTool } from "./store";

export { TEMPLATES };

export function addFromTemplate(id: string): void {
  const s = getState();
  const pageId = s.pageId;
  if (!s.doc || pageId === null) return;
  const t = template(id);
  const page = s.doc.project.pages.find((p) => p.id === pageId)!;
  const n = page.touch.length + page.display.length;
  const { w, h } = T5UID1.screen;
  const x = Math.max(0, Math.round((w - t.size[0]) / 2) + ((n * 8) % 64));
  const y = Math.max(0, Math.round((h - t.size[1]) / 2) + ((n * 8) % 64));
  const uid = edit((d) => {
    const vp = allocVp(d, t.words, T5UID1.userVp.start, T5UID1.userVp.end);
    return addControl(d, pageId, t.kind, t.make(pageId, x, y, vp));
  });
  if (uid) setState({ selection: { kind: t.kind, uid }, panel: "inspect" });
}

export function newPage(): void {
  const p = edit((d) => addPage(d));
  if (p) goPage(p.id);
}

export function nudge(dx: number, dy: number): void {
  const s = getState();
  const uid = s.selection?.uid;
  if (!s.doc || !uid) return;
  const f = findControl(s.doc, uid);
  if (!f) return;
  const bytes = moveBy(f.kind, fromHex(f.control.bytes), dx, dy, T5UID1.screen.w, T5UID1.screen.h);
  edit((d) => updateControl(d, uid, bytes), { coalesce: `nudge:${uid}`, quiet: true });
}

export function removeSelected(): void {
  const uid = getState().selection?.uid;
  if (uid) edit((d) => deleteControl(d, uid));
}

export function duplicateSelected(): void {
  const sel = getState().selection;
  if (!sel) return;
  const nu = edit((d) => duplicateControl(d, sel.uid));
  if (nu) setState({ selection: { kind: sel.kind, uid: nu } });
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function onKey(e: KeyboardEvent): void {
  const s = getState();
  if (!s.doc || typing(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && k === "y") {
    e.preventDefault();
    redo();
    return;
  }
  const step = e.shiftKey ? 10 : 1;
  if (s.mode === "picture") return pictureKey(e, k, mod, step);
  if (s.mode !== "edit") return;
  const moves: Record<string, [number, number]> = {
    arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step],
  };
  if (moves[k] && s.selection) {
    e.preventDefault();
    nudge(...moves[k]!);
  } else if ((k === "delete" || k === "backspace") && s.selection) {
    e.preventDefault();
    removeSelected();
  } else if (mod && k === "d" && s.selection) {
    e.preventDefault();
    duplicateSelected();
  } else if (k === "escape") {
    setState({ selection: null });
  }
}

const TOOL_KEYS: Record<string, ArtTool> = {
  v: "select", r: "rect", o: "ellipse", l: "line", t: "text", b: "brush", x: "eraser", i: "eyedropper",
};

function pictureKey(e: KeyboardEvent, k: string, mod: boolean, step: number): void {
  const s = getState();
  const moves: Record<string, [number, number]> = {
    arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step],
  };
  if (moves[k] && s.layerId) {
    e.preventDefault();
    nudgeLayer(...moves[k]!);
  } else if ((k === "delete" || k === "backspace") && s.layerId) {
    e.preventDefault();
    deleteLayer();
  } else if (mod && k === "d" && s.layerId) {
    e.preventDefault();
    duplicateSelectedLayer();
  } else if (k === "escape") {
    setState({ layerId: null, tool: "select" });
  } else if (!mod && TOOL_KEYS[k]) {
    setState({ tool: TOOL_KEYS[k]! });
  }
}

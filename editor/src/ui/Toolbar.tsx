import { useRef } from "preact/hooks";
import { closeDoc, edit, redo, resetSim, setState, undo, useStore, type SaveState } from "./store";
import { exportDwinSet, importFolder, openFile, saveFile } from "./actions";
import { TEMPLATES, addFromTemplate } from "./commands";

export function FilePickers({ onFolder, onFile }: { onFolder: (f: FileList) => void; onFile: (f: File) => void }) {
  const folder = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <button onClick={() => folder.current?.click()}>Import DWIN_SET folder…</button>
      <button onClick={() => file.current?.click()}>Open file…</button>
      <input
        ref={folder} type="file" multiple hidden
        // @ts-expect-error non-standard, supported by all current browsers
        webkitdirectory=""
        onChange={(e) => {
          const t = e.currentTarget;
          if (t.files?.length) onFolder(t.files);
          t.value = "";
        }}
      />
      <input
        ref={file} type="file" hidden accept=".dgusproj,.zip"
        onChange={(e) => {
          const t = e.currentTarget;
          const f = t.files?.[0];
          if (f) onFile(f);
          t.value = "";
        }}
      />
    </>
  );
}

const SAVE_TEXT: Record<SaveState, string> = {
  off: "Not stored (no IndexedDB)",
  idle: "",
  pending: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved in browser",
  error: "Save failed",
};

export function Toolbar() {
  const s = useStore();
  const doc = s.doc!;
  return (
    <header class="toolbar">
      <button class="ghost" title="Close project" onClick={closeDoc}>☰</button>
      <input
        class="title" value={doc.project.name} aria-label="Project name"
        onChange={(e) => {
          const name = e.currentTarget.value.trim() || "Untitled";
          edit((d) => void (d.project.name = name));
        }}
      />
      <span class={`save ${s.save}`} title={s.saveError}>{SAVE_TEXT[s.save]}</span>
      <button class="small" disabled={!s.past.length} title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
      <button class="small" disabled={!s.future.length} title="Redo (Ctrl+Shift+Z)" onClick={redo}>↷</button>
      <select
        class="add" value="" disabled={s.mode !== "edit"} aria-label="Add control"
        onChange={(e) => {
          const v = e.currentTarget.value;
          e.currentTarget.value = "";
          if (v) addFromTemplate(v);
        }}
      >
        <option value="">+ Add control…</option>
        <optgroup label="Touch">
          {TEMPLATES.filter((t) => t.kind === "touch").map((t) => <option key={t.id} value={t.id} title={t.hint}>{t.label}</option>)}
        </optgroup>
        <optgroup label="Display">
          {TEMPLATES.filter((t) => t.kind === "display").map((t) => <option key={t.id} value={t.id} title={t.hint}>{t.label}</option>)}
        </optgroup>
      </select>
      <span class="modes" role="group" aria-label="Mode">
        <button class={s.mode === "edit" ? "small active" : "small"} title="Place and edit controls"
          onClick={() => setState({ mode: "edit", layerId: null })}>Controls</button>
        <button class={s.mode === "picture" ? "small active" : "small"} title="Draw the page picture"
          onClick={() => setState({ mode: "picture", selection: null })}>Picture</button>
        <button
          class={s.mode === "simulate" ? "small primary" : "small"} title="Click through the project in the browser"
          onClick={() => {
            if (s.mode !== "simulate") resetSim();
            setState({ mode: s.mode === "simulate" ? "edit" : "simulate", selection: null, layerId: null });
          }}
        >
          {s.mode === "simulate" ? "■ Stop" : "▶ Simulate"}
        </button>
      </span>
      <span class="spacer" />
      <label class="small">
        Zoom
        <select value={s.zoom} onChange={(e) => setState({ zoom: Number(e.currentTarget.value) })}>
          {[1, 1.5, 2, 3, 4].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
        </select>
      </label>
      {(["touch", "display", "icons"] as const).map((k) => (
        <label key={k} class={`small layer ${k}`}>
          <input
            type="checkbox" checked={s.layers[k]}
            onChange={(e) => setState({ layers: { ...s.layers, [k]: e.currentTarget.checked } })}
          />
          {k}
        </label>
      ))}
      <FilePickers onFolder={importFolder} onFile={openFile} />
      <button onClick={saveFile} title="Download the project as a .dgusproj file">Save .dgusproj</button>
      <button class="primary" onClick={exportDwinSet} title="Download a DWIN_SET zip for the SD card">Export DWIN_SET</button>
    </header>
  );
}

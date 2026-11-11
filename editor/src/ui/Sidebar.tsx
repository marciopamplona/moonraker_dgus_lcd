import { useEffect } from "preact/hooks";
import type { Page, ProjectDoc } from "../core/project/schema";
import { classify } from "../core/formats/dwinset";
import { pictureCanvas } from "./render";
import { useRef } from "preact/hooks";
import { nandProblems, nandUses } from "../core/files/nand";
import { cfgFile, sramFile } from "../core/files/ops";
import { setCfg, setSramRuns } from "../core/files/ops";
import { decodeCfg, defaultCfgBytes } from "../core/formats/cfg";
import { goPage, edit, openFile, useStore } from "./store";
import { newPage } from "./commands";
import { addFiles, newFont, newIcons } from "./fileCommands";

function Thumb({ doc, page }: { doc: ProjectDoc; page: Page }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = page.background ? doc.assets.get(page.background) : undefined;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const src = data && pictureCanvas(data);
    if (src) ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [data]);
  return <canvas ref={ref} width={96} height={54} class="pthumb" />;
}

const size = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function Sidebar() {
  const s = useStore();
  const doc = s.doc!;
  const upload = useRef<HTMLInputElement>(null);
  return (
    <nav class="sidebar">
      <h3>
        Pages <span class="muted">{doc.project.pages.length}</span>
        <button class="small ghost push" title="Add a page" disabled={s.mode !== "edit"} onClick={newPage}>+ Page</button>
      </h3>
      <ul class="pages">
        {doc.project.pages.map((p) => (
          <li key={p.id}>
            <button
              class={p.id === s.pageId && !s.file ? "page active" : "page"}
              onClick={() => goPage(p.id)}
            >
              <Thumb doc={doc} page={p} />
              <span class="pname">
                <b>{p.id}</b> {p.name}
                <span class="muted small">
                  {p.touch.length} touch · {p.display.length} display{!p.background && " · no picture"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <h3>
        Files <span class="muted">{doc.project.files.length}</span>
        <select class="small push add-file" value="" aria-label="Add file" onChange={(e) => {
          const v = e.currentTarget.value;
          e.currentTarget.value = "";
          if (v === "icons") newIcons();
          else if (v === "font") newFont();
          else if (v === "upload") upload.current?.click();
          else if (v === "cfg") { edit((d) => setCfg(d, decodeCfg(defaultCfgBytes()))); openFile("T5UID1.CFG"); }
          else if (v === "sram") { edit((d) => setSramRuns(d, [])); openFile("22_config.bin"); }
        }}>
          <option value="">+ File…</option>
          <option value="icons">New icon library</option>
          <option value="font">New font (from TTF)</option>
          <option value="upload">Add files from disk…</option>
          {!cfgFile(doc) && <option value="cfg">Create T5UID1.CFG</option>}
          {!sramFile(doc) && <option value="sram">Create 22_config.bin</option>}
        </select>
        <input ref={upload} type="file" multiple hidden onChange={(e) => {
          const f = e.currentTarget.files;
          if (f?.length) void addFiles(f);
          e.currentTarget.value = "";
        }} />
      </h3>
      <ul class="files">
        {doc.project.files.map((f) => (
          <li key={f.name} title={f.name}>
            <button class={s.file === f.name ? "file active" : "file"} onClick={() => openFile(f.name)}>
              <span class={`tag ${f.kind}`}>{f.kind}</span>
              <span class="fname">{f.name}</span>
              <span class="muted small">{size(doc.assets.get(f.name)?.length ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>
      {nandProblems(nandUses(doc)).map((p) => <p key={p.text} class="bad small">{p.text}</p>)}
      {classifyMissing(doc).map((m) => <p key={m} class="warn small">{m}</p>)}
    </nav>
  );
}

function classifyMissing(doc: ProjectDoc): string[] {
  const kinds = new Set(doc.project.files.map((f) => f.kind));
  const out: string[] = [];
  if (!kinds.has("config")) out.push("No T5UID1.CFG: the screen keeps its current hardware config.");
  if (!doc.project.files.some((f) => f.kind === "font" && classify(f.name).id === 0)) {
    out.push("No 0_DWIN_ASC.HZK: the screen keeps the ASCII font already in flash.");
  }
  return out;
}

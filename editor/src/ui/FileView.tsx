import { useEffect, useRef, useState } from "preact/hooks";
import { countLibRefs } from "../core/files/ops";
import { nandUse } from "../core/files/nand";
import { classify } from "../core/formats/dwinset";
import { CfgView } from "./CfgView";
import { FontView } from "./FontView";
import { IconsView } from "./IconsView";
import { SramView } from "./SramView";
import { download, remove, rename, replaceWith } from "./fileCommands";
import { openFile, useStore } from "./store";

const size = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function AudioView({ name, data }: { name: string; data: Uint8Array }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: "audio/wav" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return (
    <section class="stage fileview">
      <h2>{name} <span class="muted small">sound</span></h2>
      {url && <audio controls src={url} />}
      <p class="muted small">Sounds are played by id (e.g. the touch click and the boot music in the CFG). They load from the SD card; serial upload doesn't support WAV.</p>
    </section>
  );
}

function GenericView({ name, data }: { name: string; data: Uint8Array }) {
  const rows: string[] = [];
  for (let i = 0; i < Math.min(256, data.length); i += 16) {
    rows.push(i.toString(16).padStart(4, "0") + "  " + Array.from(data.subarray(i, i + 16), (b) => b.toString(16).padStart(2, "0")).join(" "));
  }
  return (
    <section class="stage fileview">
      <h2>{name} <span class="muted small">{classify(name).kind} · {size(data.length)}</span></h2>
      <p class="muted small">Kept exactly as imported.</p>
      <pre class="hex">{rows.join("\n")}{data.length > 256 ? "\n…" : ""}</pre>
    </section>
  );
}

export function FileView() {
  const s = useStore();
  const doc = s.doc!;
  const name = s.file!;
  const data = doc.assets.get(name);
  if (!data) return <section class="stage empty muted">File not found</section>;
  const f = classify(name);
  switch (f.kind) {
    case "icons": return <IconsView name={name} />;
    case "font": return <FontView name={name} />;
    case "config": return <CfgView name={name} />;
    case "sraminit": return <SramView name={name} />;
    case "audio": return <AudioView name={name} data={data} />;
    default: return <GenericView name={name} data={data} />;
  }
}

export function FilePanel() {
  const s = useStore();
  const doc = s.doc!;
  const name = s.file!;
  const data = doc.assets.get(name);
  const f = classify(name);
  const repl = useRef<HTMLInputElement>(null);
  const [id, setId] = useState(String(f.id ?? ""));
  const [label, setLabel] = useState(f.label);
  useEffect(() => {
    setId(String(f.id ?? ""));
    setLabel(f.label);
  }, [name]);
  if (!data) return <aside class="inspector" />;
  const use = nandUse(name, data.length);
  const refs = f.kind === "icons" || f.kind === "font" ? countLibRefs(doc, f.id ?? -1) : 0;

  return (
    <aside class="inspector">
      <button class="ghost small" onClick={() => openFile(null)}>← pages</button>
      <h3>{name}</h3>
      <dl>
        <dt>Kind</dt><dd>{f.kind}</dd>
        <dt>Size</dt><dd>{size(data.length)}</dd>
        {use && <><dt>NAND</dt><dd class="small">font ids {use.firstId}{use.lastId !== use.firstId ? `–${use.lastId}` : ""}</dd></>}
        {(f.kind === "icons" || f.kind === "font") && <><dt>Used by</dt><dd class="small">{refs} control field(s)</dd></>}
      </dl>
      {f.id !== null && (
        <>
          <h4>Name</h4>
          <div class="rename">
            <input class="mono num" value={id} aria-label="File id" onInput={(e) => setId(e.currentTarget.value)} />
            <input value={label} aria-label="File label" onInput={(e) => setLabel(e.currentTarget.value)} />
            <button class="small" onClick={() => {
              const n = parseInt(id, 10);
              if (!Number.isInteger(n)) return alert("The id must be a number");
              if (n !== f.id && refs && !confirm(`${refs} control field(s) use id ${f.id}; they will be changed to ${n}.`)) return;
              rename(name, n, label);
            }}>Rename</button>
          </div>
          <p class="muted small">The id is the file's place in the screen's flash (fonts and icons: 256 KB per id). Controls refer to icon libraries and fonts by id.</p>
        </>
      )}
      <div class="row">
        <button class="small" onClick={() => download(data, name)}>Download</button>
        <button class="small" onClick={() => repl.current?.click()}>Replace…</button>
        <button class="small danger" onClick={() => {
          if (confirm(`Delete ${name}?${refs ? `\n${refs} control field(s) use it.` : ""}`)) remove(name);
        }}>Delete</button>
        <input ref={repl} type="file" hidden onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void replaceWith(name, file);
        }} />
      </div>
    </aside>
  );
}

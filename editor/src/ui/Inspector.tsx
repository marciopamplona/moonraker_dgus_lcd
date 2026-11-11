import { useRef, useState } from "preact/hooks";
import { fromHex, hex } from "../core/bytes";
import { fieldRange, fieldSpecs, formatField, readField, writeField, type Field, type FieldSpec } from "../core/controls/describe";
import { from565, to565 } from "../core/formats/rgb565";
import {
  countPageRefs, deleteControl, deletePage, duplicateControl, duplicatePage, renamePage, renumberPage,
  reorderControl, setBackground, updateControl,
} from "../core/project/ops";
import type { Page, ProjectDoc } from "../core/project/schema";
import { T5UID1 } from "../core/profile/t5uid1";
import { pageControls, vpHex, type PlacedControl } from "./controls";
import { imageToBitmap, type Fit } from "./images";
import { edit, goPage, setState, useStore } from "./store";

function hexDump(b: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < b.length; i += 16) {
    rows.push(i.toString(16).padStart(2, "0") + "  " +
      Array.from(b.subarray(i, i + 16), (x) => x.toString(16).padStart(2, "0")).join(" "));
  }
  return rows.join("\n");
}

/** "0x1A", "26", "-3" -> number, or null. */
export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (/^-?0x[0-9a-f]+$/i.test(t)) return (t.startsWith("-") ? -1 : 1) * parseInt(t.replace(/^-?0x/i, ""), 16);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

const rgbHex = (v: number) => "#" + from565(v).map((c) => c.toString(16).padStart(2, "0")).join("");

function FieldInput({ field, doc, onSet }: { field: Field; doc: ProjectDoc; onSet: (v: number) => void }) {
  const [err, setErr] = useState(false);
  if (field.fixed) return <span class="mono muted">{formatField(field)}</span>;
  if (field.fmt === "page") {
    const none = field.value >> 8 === 0xff;
    return (
      <select class="mono" value={none ? "none" : String(field.value)}
        onChange={(e) => onSet(e.currentTarget.value === "none" ? 0xff00 : Number(e.currentTarget.value))}>
        <option value="none">none</option>
        {!none && !doc.project.pages.some((p) => p.id === field.value) && (
          <option value={String(field.value)}>{field.value} (missing)</option>
        )}
        {doc.project.pages.map((p) => <option key={p.id} value={String(p.id)}>{p.id} {p.name}</option>)}
      </select>
    );
  }
  const text = formatField(field);
  const [lo, hi] = fieldRange(field);
  return (
    <span class="field-edit">
      {field.fmt === "color" && (
        <input type="color" value={rgbHex(field.value)} title={`RGB565 ${text}`}
          onInput={(e) => {
            const v = e.currentTarget.value;
            onSet(to565(parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)));
          }} />
      )}
      <input
        class={`mono num${err ? " invalid" : ""}`} value={text} key={text}
        title={`${lo} … ${hi}${field.note ? " · " + field.note : ""}`}
        onChange={(e) => {
          const v = parseNumber(e.currentTarget.value);
          if (v === null || v < lo || v > hi) return setErr(true);
          setErr(false);
          onSet(v);
        }}
      />
    </span>
  );
}

function ControlInspector({ cur, page, doc }: { cur: PlacedControl; page: Page; doc: ProjectDoc }) {
  const i = cur.info;
  const uid = cur.control.uid;
  const [raw, setRaw] = useState<string | null>(null);
  const specs = fieldSpecs(cur.kind, cur.bytes);
  const set = (s: FieldSpec, v: number) =>
    edit((d) => updateControl(d, uid, writeField(cur.bytes, s, v)), { coalesce: `field:${uid}:${s.off}` });
  const fields: Field[] = specs.map((s) => ({ ...s, value: readField(cur.bytes, s) }));
  const list = page[cur.kind];
  const idx = list.findIndex((c) => c.uid === uid);

  return (
    <>
      <button class="ghost small" onClick={() => setState({ selection: null })}>← page {page.id}</button>
      <h3><span class={`dot ${cur.kind}`} />{i.typeName}</h3>
      <p class="muted small">
        {cur.kind === "touch" ? "Touch area (13*.BIN)" : "Display variable (14*.BIN)"} · VP {vpHex(i.vp)}
        {i.bounds && ` · (${i.bounds[0]}, ${i.bounds[1]})–(${i.bounds[2]}, ${i.bounds[3]})`}
        {i.estimated && " · size estimated"}
      </p>
      <div class="row">
        <button class="small" title="Ctrl+D" onClick={() => {
          const nu = edit((d) => duplicateControl(d, uid));
          if (nu) setState({ selection: { kind: cur.kind, uid: nu } });
        }}>Duplicate</button>
        <button class="small" disabled={idx <= 0} title={cur.kind === "touch" ? "Earlier = lower priority" : "Draw earlier (below)"}
          onClick={() => edit((d) => reorderControl(d, uid, -1))}>Back</button>
        <button class="small" disabled={idx >= list.length - 1} onClick={() => edit((d) => reorderControl(d, uid, 1))}>Front</button>
        <button class="small danger" title="Delete" onClick={() => edit((d) => deleteControl(d, uid))}>Delete</button>
      </div>
      {i.jumpTo !== null && (
        <p><button class="link" onClick={() => goPage(i.jumpTo!)}>Go to page {i.jumpTo} →</button></p>
      )}
      <table class="fields">
        <tbody>
          {fields.map((f) => (
            <tr key={f.name + f.off}>
              <td class="muted small">{f.off.toString(16).padStart(2, "0")}</td>
              <td title={f.note}>{f.name}</td>
              <td><FieldInput field={f} doc={doc} onSet={(v) => set(f, v)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Raw bytes</h4>
      {raw === null ? (
        <>
          <pre class="hex">{hexDump(cur.bytes)}</pre>
          <button class="small" onClick={() => setRaw(hex(cur.bytes))}>Edit raw bytes…</button>
        </>
      ) : (
        <>
          <textarea class="mono raw" rows={5} value={raw} onInput={(e) => setRaw(e.currentTarget.value)} />
          <div class="row">
            <button class="small primary" onClick={() => {
              const clean = raw.replace(/[^0-9a-f]/gi, "");
              if (clean.length !== cur.bytes.length * 2) return alert(`Need exactly ${cur.bytes.length} bytes`);
              if (edit((d) => (updateControl(d, uid, fromHex(clean)), true))) setRaw(null);
            }}>Apply</button>
            <button class="small" onClick={() => setRaw(null)}>Cancel</button>
          </div>
        </>
      )}
    </>
  );
}

function PageInspector({ page, doc, placed }: { page: Page; doc: ProjectDoc; placed: PlacedControl[] }) {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [fit, setFit] = useState<Fit>("cover");
  const refs = countPageRefs(doc, page.id);

  async function replacePicture(f: File) {
    try {
      const { w, h } = T5UID1.screen;
      const bm = await imageToBitmap(f, w, h, fit);
      edit((d) => setBackground(d, page.id, bm.save()));
    } catch (e) {
      alert(`Can't use this image: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <>
      <h3>Page {page.id}</h3>
      <dl class="form">
        <dt>Name</dt>
        <dd>
          <input value={page.name} key={page.name}
            onChange={(e) => edit((d) => renamePage(d, page.id, e.currentTarget.value))} />
        </dd>
        <dt>Id</dt>
        <dd>
          <input class="mono num" value={String(page.id)} key={page.id}
            onChange={(e) => {
              const to = parseNumber(e.currentTarget.value);
              if (to === null) return;
              const msg = refs ? `Renumber page ${page.id} → ${to}? ${refs} reference(s) to it will be updated.` : `Renumber page ${page.id} → ${to}?`;
              if (!confirm(msg)) return void (e.currentTarget.value = String(page.id));
              if (edit((d) => renumberPage(d, page.id, to)) !== undefined) goPage(to);
            }} />
        </dd>
        <dt>Picture</dt><dd class="small">{page.background ?? "none"}</dd>
        <dt>Referenced</dt><dd class="small">{refs} time(s) by other controls</dd>
      </dl>
      <div class="row">
        <button class="small" onClick={() => file.current?.click()}>Replace picture…</button>
        <select class="small" value={fit} onChange={(e) => setFit(e.currentTarget.value as Fit)} title="How to fit images that aren't 480×272">
          <option value="cover">cover</option>
          <option value="contain">contain</option>
          <option value="stretch">stretch</option>
        </select>
        <input ref={file} type="file" hidden accept="image/*,.bmp"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void replacePicture(f);
          }} />
      </div>
      <div class="row">
        <button class="small" onClick={() => {
          const p = edit((d) => duplicatePage(d, page.id));
          if (p) goPage(p.id);
        }}>Duplicate page</button>
        <button class="small danger" onClick={() => {
          const msg = `Delete page ${page.id} "${page.name}" with ${page.touch.length + page.display.length} controls?` +
            (refs ? `\n${refs} reference(s) to it will point nowhere.` : "");
          if (confirm(msg)) edit((d) => deletePage(d, page.id));
        }}>Delete page</button>
      </div>
      <h4>Controls ({placed.length})</h4>
      <ul class="ctl-list">
        {placed.map((p) => (
          <li key={p.control.uid}>
            <button class="link" onClick={() => setState({ selection: { kind: p.kind, uid: p.control.uid } })}>
              <span class={`dot ${p.kind}`} />{p.info.typeName}
            </button>
            <span class="muted small">{vpHex(p.info.vp)}</span>
          </li>
        ))}
      </ul>
      {s.warnings.length > 0 && (
        <>
          <h4>Import notes</h4>
          <ul class="warnings">{s.warnings.map((w, i) => <li key={i} class="warn small">{w}</li>)}</ul>
        </>
      )}
    </>
  );
}

export function Inspector() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  if (!page) return null;
  const placed = pageControls(doc, page);
  const cur = placed.find((p) => p.control.uid === s.selection?.uid);
  return cur ? <ControlInspector cur={cur} page={page} doc={doc} /> : <PageInspector page={page} doc={doc} placed={placed} />;
}

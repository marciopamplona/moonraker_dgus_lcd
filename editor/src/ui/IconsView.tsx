import { useEffect, useRef, useState } from "preact/hooks";
import { deleteIcon, iconFromRGBA, iconIdFromName, iconUsage, moveIcon, setIcons } from "../core/files/ops";
import { classify } from "../core/formats/dwinset";
import { IconLibrary, iconToBitmap, type Icon } from "../core/formats/ico";
import { Bitmap } from "../core/formats/bmp";
import { iconCanvas } from "./render";
import { download } from "./fileCommands";
import { edit, useStore } from "./store";

const libCache = new WeakMap<Uint8Array, IconLibrary>();
function parse(data: Uint8Array): IconLibrary {
  let lib = libCache.get(data);
  if (!lib) libCache.set(data, (lib = IconLibrary.parse(data)));
  return lib;
}

function Thumb({ lib, id, size, transparent }: { lib: IconLibrary; id: number; size: number; transparent: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ic = lib.icons.get(id)!;
  const k = Math.min(1, size / Math.max(ic.w, ic.h)) || 1;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const src = iconCanvas(lib, id, transparent);
    if (src) ctx.drawImage(src, 0, 0);
  });
  return <canvas ref={ref} width={ic.w} height={ic.h} class="icon-thumb" style={{ width: Math.max(1, ic.w * k), height: Math.max(1, ic.h * k) }} />;
}

/** Image file -> icon: decoded by the browser, fitted inside `max` px. */
async function fileToIcon(file: File, max: number, transparency: boolean): Promise<Icon> {
  let w: number, h: number, rgba: Uint8ClampedArray;
  if (/\.bmp$/i.test(file.name)) {
    const bm = Bitmap.load(new Uint8Array(await file.arrayBuffer()));
    if (bm.w <= max && bm.h <= max) return iconFromRGBA(bm.w, bm.h, bm.toRGBA(), { transparency });
  }
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / img.width, max / img.height);
  w = Math.max(1, Math.round(img.width * k));
  h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  rgba = ctx.getImageData(0, 0, w, h).data;
  return iconFromRGBA(w, h, rgba, { transparency });
}

export function IconsView({ name }: { name: string }) {
  const s = useStore();
  const doc = s.doc!;
  const data = doc.assets.get(name)!;
  const lib = parse(data);
  const libId = classify(name).id ?? -1;
  const usage = iconUsage(doc, libId);
  const ids = [...lib.icons.keys()].sort((a, b) => a - b);
  const [sel, setSel] = useState<number | null>(null);
  const [transparent, setTransparent] = useState(true);
  const [importAlpha, setImportAlpha] = useState(true);
  const [max, setMax] = useState(255);
  const add = useRef<HTMLInputElement>(null);
  const repl = useRef<HTMLInputElement>(null);
  const cur = sel !== null && lib.icons.has(sel) ? sel : null;

  async function importFiles(files: File[], replaceId: number | null) {
    const errors: string[] = [];
    const out: [number, Icon][] = [];
    let next = ids.length ? Math.max(...ids) + 1 : 0;
    for (const f of files) {
      try {
        const ic = await fileToIcon(f, Math.max(1, Math.min(255, max)), importAlpha);
        const id = replaceId ?? iconIdFromName(f.name) ?? next++;
        out.push([id, ic]);
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (out.length) edit((d) => setIcons(d, name, out));
    if (errors.length) alert(errors.join("\n"));
    if (out.length === 1) setSel(out[0]![0]);
  }

  return (
    <section class="stage fileview">
      <h2>{name} <span class="muted small">icon library · {ids.length} icons</span></h2>
      <div class="row">
        <button class="small primary" onClick={() => add.current?.click()}>Add images…</button>
        <label class="small" title="Pixels with alpha < 50% become black, which the screen hides when an icon is shown in transparent mode; opaque black is nudged to 0x0020 so it stays visible">
          <input type="checkbox" checked={importAlpha} onChange={(e) => setImportAlpha(e.currentTarget.checked)} /> transparency → black</label>
        <label class="small">max size <input type="number" class="num" min={1} max={255} value={max}
          onChange={(e) => setMax(Number(e.currentTarget.value) || 255)} /> px</label>
        <label class="small"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.currentTarget.checked)} /> show black as transparent</label>
        <input ref={add} type="file" multiple hidden accept="image/*,.bmp" onChange={(e) => {
          const f = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (f.length) void importFiles(f, null);
        }} />
        <input ref={repl} type="file" hidden accept="image/*,.bmp" onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f && cur !== null) void importFiles([f], cur);
        }} />
      </div>
      <p class="muted small">Icon ids come from numbers in file names (12.png → icon 12), else the next free id. Icons are at most 255×255.</p>
      <ul class="icon-grid">
        {ids.map((id) => {
          const ic = lib.icons.get(id)!;
          return (
            <li key={id}>
              <button class={cur === id ? "icon-cell active" : "icon-cell"} onClick={() => setSel(id)} title={`icon ${id}: ${ic.w}×${ic.h}`}>
                <span class="checker"><Thumb lib={lib} id={id} size={72} transparent={transparent} /></span>
                <span class="small"><b>{id}</b> <span class="muted">{ic.w}×{ic.h}</span></span>
                {usage.get(id) ? <span class="used small">used {usage.get(id)}×</span> : <span class="muted small">unused</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {cur !== null && (
        <div class="icon-detail">
          <h3>Icon {cur}</h3>
          <span class="checker big"><Thumb lib={lib} id={cur} size={255} transparent={transparent} /></span>
          <div class="row">
            <button class="small" onClick={() => repl.current?.click()}>Replace…</button>
            <button class="small" onClick={() => {
              const v = prompt(`New id for icon ${cur}`, String(cur));
              const to = v === null ? NaN : parseInt(v, 10);
              if (Number.isInteger(to) && to !== cur && edit((d) => (moveIcon(d, name, cur, to), true))) setSel(to);
            }}>Change id…</button>
            <button class="small" onClick={() => download(iconToBitmap(lib.icons.get(cur)!).save(), `${cur}.bmp`)}>Download BMP</button>
            <button class="small danger" onClick={() => {
              if ((usage.get(cur) ?? 0) && !confirm(`Icon ${cur} is used ${usage.get(cur)} time(s). Delete it?`)) return;
              edit((d) => deleteIcon(d, name, cur));
              setSel(null);
            }}>Delete</button>
          </div>
        </div>
      )}
    </section>
  );
}

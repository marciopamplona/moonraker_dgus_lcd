import { useRef, useState } from "preact/hooks";
import { SYSTEM_FONTS, type Layer } from "../core/art/schema";
import {
  addImageFile, addLayer, deleteLayer, discardArt, duplicateSelectedLayer, moveSelectedLayer, patchLayer,
  pressedVariant, setArtSetting, setLayer, uploadFont,
} from "./artCommands";
import { setState, useStore, type ArtTool } from "./store";

const TOOLS: [ArtTool, string, string][] = [
  ["select", "↖", "Select / move (V)"],
  ["rect", "▭", "Rectangle (R)"],
  ["ellipse", "◯", "Ellipse (O)"],
  ["line", "╱", "Line (L)"],
  ["text", "T", "Text (T)"],
  ["brush", "✎", "Brush (B)"],
  ["eraser", "⌫", "Eraser (X)"],
  ["eyedropper", "⊙", "Pick colour (I)"],
];

const ICON: Record<Layer["type"], string> = { image: "▣", rect: "▭", ellipse: "◯", line: "╱", text: "T", paint: "✎" };

function Num({ label, value, onSet, min, max, k }: { label: string; value: number; onSet: (v: number) => void; min?: number; max?: number; k: string }) {
  return (
    <label class="prop">
      <span>{label}</span>
      <input type="number" class="num" value={value} min={min} max={max} key={`${k}:${value}`}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isFinite(v)) onSet(v);
        }} />
    </label>
  );
}

function ColorIn({ label, value, onSet, nullable, k }: { label: string; value: string | null; onSet: (v: string | null) => void; nullable?: boolean; k: string }) {
  return (
    <label class="prop">
      <span>{label}</span>
      <span class="field-edit">
        {nullable && (
          <input type="checkbox" checked={value !== null} title="Enabled"
            onChange={(e) => onSet(e.currentTarget.checked ? (value ?? "#ffffff") : null)} />
        )}
        <input type="color" value={value ?? "#000000"} disabled={value === null} key={k}
          onInput={(e) => onSet(e.currentTarget.value)} />
      </span>
    </label>
  );
}

function LayerProps({ l, fonts }: { l: Layer; fonts: string[] }) {
  const p = (patch: Partial<Layer>, key?: string) => patchLayer(patch, key);
  const k = l.id;
  return (
    <div class="props">
      <label class="prop"><span>Name</span>
        <input value={l.name} key={`${k}:name:${l.name}`} onChange={(e) => p({ name: e.currentTarget.value })} /></label>
      <label class="prop"><span>Opacity</span>
        <input type="range" min={0} max={100} value={Math.round(l.opacity * 100)}
          onInput={(e) => p({ opacity: Number(e.currentTarget.value) / 100 }, "opacity")} /></label>
      {(l.type === "image" || l.type === "rect" || l.type === "ellipse") && (
        <div class="grid4">
          <Num label="X" value={l.x} k={k} onSet={(v) => p({ x: v })} />
          <Num label="Y" value={l.y} k={k} onSet={(v) => p({ y: v })} />
          <Num label="W" value={l.w} min={1} k={k} onSet={(v) => p({ w: Math.max(1, v) })} />
          <Num label="H" value={l.h} min={1} k={k} onSet={(v) => p({ h: Math.max(1, v) })} />
        </div>
      )}
      {(l.type === "rect" || l.type === "ellipse") && (
        <>
          <ColorIn label="Fill" value={l.fill} nullable k={`${k}f`} onSet={(v) => p({ fill: v }, "fill")} />
          <ColorIn label="Border" value={l.stroke} nullable k={`${k}s`} onSet={(v) => p({ stroke: v }, "stroke")} />
          <Num label="Border width" value={l.strokeWidth} min={0} k={k} onSet={(v) => p({ strokeWidth: Math.max(0, v) })} />
        </>
      )}
      {l.type === "rect" && (
        <>
          <Num label="Corner radius" value={l.radius} min={0} k={k} onSet={(v) => p({ radius: Math.max(0, v) })} />
          <label class="prop"><span>Gradient</span>
            <span class="field-edit">
              <input type="checkbox" checked={!!l.gradient}
                onChange={(e) => p({ gradient: e.currentTarget.checked ? { to: "#000000", dir: "v" } : null })} />
              {l.gradient && (
                <>
                  <input type="color" value={l.gradient.to} onInput={(e) => p({ gradient: { ...l.gradient!, to: e.currentTarget.value } }, "grad")} />
                  <select value={l.gradient.dir} onChange={(e) => p({ gradient: { ...l.gradient!, dir: e.currentTarget.value as "v" | "h" } })}>
                    <option value="v">vertical</option>
                    <option value="h">horizontal</option>
                  </select>
                </>
              )}
            </span>
          </label>
        </>
      )}
      {l.type === "line" && (
        <>
          <div class="grid4">
            <Num label="X1" value={l.x1} k={k} onSet={(v) => p({ x1: v })} />
            <Num label="Y1" value={l.y1} k={k} onSet={(v) => p({ y1: v })} />
            <Num label="X2" value={l.x2} k={k} onSet={(v) => p({ x2: v })} />
            <Num label="Y2" value={l.y2} k={k} onSet={(v) => p({ y2: v })} />
          </div>
          <ColorIn label="Colour" value={l.color} k={`${k}c`} onSet={(v) => p({ color: v! }, "color")} />
          <Num label="Width" value={l.width} min={1} k={k} onSet={(v) => p({ width: Math.max(1, v) })} />
        </>
      )}
      {l.type === "text" && (
        <>
          <label class="prop col"><span>Text</span>
            <textarea rows={2} value={l.text} onInput={(e) => p({ text: e.currentTarget.value }, "text")} /></label>
          <div class="grid4">
            <Num label="X" value={l.x} k={k} onSet={(v) => p({ x: v })} />
            <Num label="Y" value={l.y} k={k} onSet={(v) => p({ y: v })} />
            <Num label="Size" value={l.size} min={4} k={k} onSet={(v) => p({ size: Math.max(4, v) })} />
          </div>
          <label class="prop"><span>Font</span>
            <select value={l.font} onChange={(e) => p({ font: e.currentTarget.value })}>
              {[...SYSTEM_FONTS, ...fonts].map((f) => <option key={f} value={f}>{f}</option>)}
            </select></label>
          <ColorIn label="Colour" value={l.color} k={`${k}c`} onSet={(v) => p({ color: v! }, "color")} />
          <label class="prop"><span>Style</span>
            <span class="field-edit">
              <label class="small"><input type="checkbox" checked={l.bold} onChange={(e) => p({ bold: e.currentTarget.checked })} /> bold</label>
              <select value={l.align} onChange={(e) => p({ align: e.currentTarget.value as "left" })}>
                <option value="left">left</option><option value="center">centre</option><option value="right">right</option>
              </select>
            </span>
          </label>
        </>
      )}
      {l.type === "paint" && <p class="muted small">{l.strokes.length} stroke(s). Paint with the brush; the eraser only removes this layer's paint.</p>}
      {l.type === "image" && <p class="muted small">{l.asset.replace(/^art\//, "")}</p>}
    </div>
  );
}

export function LayersPanel() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  const img = useRef<HTMLInputElement>(null);
  const font = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(true);
  if (!page) return null;
  const art = page.art;
  const layers = art ? [...art.layers].reverse() : [];
  const sel = art?.layers.find((l) => l.id === s.layerId) ?? null;
  const fonts = (doc.project.artFonts ?? []).map((f) => f.family);

  return (
    <>
      <h3>Picture: page {page.id}</h3>
      <div class="tools">
        {TOOLS.map(([t, icon, title]) => (
          <button key={t} class={s.tool === t ? "tool active" : "tool"} title={title} aria-label={title}
            onClick={() => setState({ tool: t })}>{icon}</button>
        ))}
      </div>
      <div class="row">
        <label class="small">Colour <input type="color" value={s.brush.color}
          onInput={(e) => setState({ brush: { ...s.brush, color: e.currentTarget.value } })} /></label>
        <label class="small">Brush <input type="number" class="num" min={1} max={80} value={s.brush.width}
          onChange={(e) => setState({ brush: { ...s.brush, width: Math.max(1, Number(e.currentTarget.value) || 1) } })} /></label>
      </div>
      <div class="row">
        <select value="" aria-label="Add layer" onChange={(e) => {
          const v = e.currentTarget.value;
          e.currentTarget.value = "";
          if (v) addLayer(v as Layer["type"]);
        }}>
          <option value="">+ Layer…</option>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="line">Line</option>
          <option value="text">Text</option>
          <option value="paint">Paint</option>
        </select>
        <button class="small" onClick={() => img.current?.click()}>+ Image…</button>
        <button class="small" onClick={() => font.current?.click()} title="TTF, OTF or WOFF for text layers">Font…</button>
        <input ref={img} type="file" hidden accept="image/*,.bmp" onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void addImageFile(f);
        }} />
        <input ref={font} type="file" hidden accept=".ttf,.otf,.woff,.woff2" onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void uploadFont(f);
        }} />
      </div>
      <h4>Layers {art ? `(${art.layers.length})` : ""}</h4>
      {!art && <p class="muted small">This picture has no layers yet. Your first change keeps the current picture as a locked bottom layer.</p>}
      <ul class="layers">
        {layers.map((l) => (
          <li key={l.id} class={l.id === s.layerId ? "active" : ""}>
            <button class="ghost small" title={l.visible ? "Hide" : "Show"}
              onClick={() => setLayer(l.id, (x) => ({ ...x, visible: !x.visible }))}>{l.visible ? "◉" : "○"}</button>
            <button class="ghost small" title={l.locked ? "Unlock" : "Lock"}
              onClick={() => setLayer(l.id, (x) => ({ ...x, locked: !x.locked }))}>{l.locked ? "🔒" : "·"}</button>
            <button class="link lname" onClick={() => setState({ layerId: l.id, tool: "select" })}>
              <span class="licon">{ICON[l.type]}</span>{l.name}
            </button>
          </li>
        ))}
      </ul>
      {sel && (
        <>
          <div class="row">
            <button class="small" onClick={() => moveSelectedLayer(1)} title="Towards the top">Up</button>
            <button class="small" onClick={() => moveSelectedLayer(-1)}>Down</button>
            <button class="small" onClick={duplicateSelectedLayer} title="Ctrl+D">Duplicate</button>
            <button class="small danger" onClick={deleteLayer} title="Delete">Delete</button>
          </div>
          <LayerProps l={sel} fonts={fonts} />
        </>
      )}
      <h4>Page picture</h4>
      {art && (
        <div class="props">
          <label class="prop"><span>Background</span>
            <input type="color" value={art.background} onInput={(e) => setArtSetting({ background: e.currentTarget.value }, "bg")} /></label>
          <label class="prop"><span>Dither to RGB565</span>
            <input type="checkbox" checked={art.dither} onChange={(e) => setArtSetting({ dither: e.currentTarget.checked })} /></label>
        </div>
      )}
      <label class="small"><input type="checkbox" checked={s.preview565} onChange={(e) => setState({ preview565: e.currentTarget.checked })} /> Preview as RGB565 (what the screen shows)</label>
      <div class="row">
        <button class="small" onClick={() => pressedVariant(link)}
          title="Copy this page as the picture shown while a button is held (Pic_On)">Create pressed variant</button>
        <label class="small"><input type="checkbox" checked={link} onChange={(e) => setLink(e.currentTarget.checked)} /> use as Pic_On</label>
      </div>
      {art && (
        <button class="small" onClick={() => confirm("Forget the layers and keep the picture as it is now?") && discardArt()}>
          Flatten (drop layers)
        </button>
      )}
    </>
  );
}

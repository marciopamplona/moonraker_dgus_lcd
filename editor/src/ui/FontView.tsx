import { useEffect, useRef, useState } from "preact/hooks";
import { SYSTEM_FONTS } from "../core/art/schema";
import { isAsciiLib } from "../core/files/ops";
import { DEFAULT_RASTER, PRINTABLE, generateAscii, rasterGlyph, type RasterOptions } from "../core/fonts/raster";
import { ASCII_HEIGHTS, AsciiFontLib, type Glyph } from "../core/formats/hzk";
import { canvasFactory } from "./artEnv";
import { uploadFont } from "./artCommands";
import { edit, endGroup, useStore } from "./store";

function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, k: number, on = "#fff") {
  ctx.fillStyle = on;
  for (let yy = 0; yy < g.h; yy++) for (let xx = 0; xx < g.w; xx++) if (g.bits[yy * g.w + xx]) ctx.fillRect(x + xx * k, y + yy * k, k, k);
}

function GlyphCanvas({ draw, w, h, onPick, class: cls }: { draw: (c: CanvasRenderingContext2D) => void; w: number; h: number; onPick?: (x: number, y: number, e: PointerEvent) => void; class?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    draw(ctx);
  });
  const at = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return r.width ? [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h] : [e.offsetX, e.offsetY];
  };
  return (
    <canvas ref={ref} width={w} height={h} class={cls}
      onPointerDown={(e) => onPick?.(...at(e), e)}
      onPointerMove={(e) => e.buttons & 1 && onPick?.(...at(e), e)}
      onPointerUp={() => endGroup()} />
  );
}

function setGlyphIn(name: string, h: number, code: number, g: Glyph, group: string) {
  edit((d) => {
    const lib = new AsciiFontLib(d.assets.get(name)!);
    lib.setGlyph(h, code, g);
    d.assets.set(name, lib.build());
  }, { coalesce: group, quiet: true });
}

function Generator({ name }: { name: string }) {
  const s = useStore();
  const doc = s.doc!;
  const families = [...SYSTEM_FONTS, ...(doc.project.artFonts ?? []).map((f) => f.family)];
  const [o, setO] = useState<RasterOptions>({ ...DEFAULT_RASTER, family: families.at(-1) ?? "sans-serif" });
  const [from, setFrom] = useState(8);
  const [to, setTo] = useState(128);
  const [progress, setProgress] = useState<number | null>(null);
  const cancel = useRef(false);
  const ttf = useRef<HTMLInputElement>(null);
  const sample = "AaGg09%";
  const ph = 32;
  const set = (patch: Partial<RasterOptions>) => setO({ ...o, ...patch });

  async function run() {
    const heights = ASCII_HEIGHTS.filter((h) => h >= from && h <= to);
    const lib = new AsciiFontLib(doc.assets.get(name)!);
    cancel.current = false;
    setProgress(0);
    try {
      for (let i = 0; i < heights.length; i++) {
        generateAscii(lib, canvasFactory(), { ...o, heights: [heights[i]!], codes: PRINTABLE });
        setProgress((i + 1) / heights.length);
        await new Promise((r) => setTimeout(r, 0));
        if (cancel.current) throw new Error("cancelled");
      }
      edit((d) => void d.assets.set(name, lib.build()));
    } catch (e) {
      if (!(e instanceof Error && e.message === "cancelled")) alert(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div class="generator">
      <h3>Generate from a font</h3>
      <p class="muted small">Draws the printable ASCII characters (0x20–0x7E) of a font into this library, at every chosen height (width = height / 2). Other characters keep their current glyphs.</p>
      <div class="gen-grid">
        <label class="prop"><span>Font</span>
          <span class="field-edit">
            <select value={o.family} onChange={(e) => set({ family: e.currentTarget.value })}>
              {families.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <button class="small" onClick={() => ttf.current?.click()}>Upload…</button>
          </span>
        </label>
        <label class="prop"><span>Heights</span>
          <span class="field-edit">
            <select value={from} onChange={(e) => setFrom(Number(e.currentTarget.value))}>{ASCII_HEIGHTS.map((h) => <option key={h} value={h}>{h}</option>)}</select>
            –
            <select value={to} onChange={(e) => setTo(Number(e.currentTarget.value))}>{ASCII_HEIGHTS.map((h) => <option key={h} value={h}>{h}</option>)}</select>
          </span>
        </label>
        <label class="prop"><span>Size</span><input type="range" min={50} max={130} value={Math.round(o.scale * 100)} onInput={(e) => set({ scale: Number(e.currentTarget.value) / 100 })} /></label>
        <label class="prop"><span>Offset X / Y</span>
          <span class="field-edit">
            <input type="number" class="num" step={0.5} value={o.dx} onChange={(e) => set({ dx: Number(e.currentTarget.value) || 0 })} />
            <input type="number" class="num" step={0.5} value={o.dy} onChange={(e) => set({ dy: Number(e.currentTarget.value) || 0 })} />
          </span>
        </label>
        <label class="prop"><span>Threshold</span><input type="range" min={20} max={230} value={o.threshold} onInput={(e) => set({ threshold: Number(e.currentTarget.value) })} /></label>
        <label class="prop"><span>Bold</span><input type="checkbox" checked={o.bold} onChange={(e) => set({ bold: e.currentTarget.checked })} /></label>
      </div>
      <input ref={ttf} type="file" hidden accept=".ttf,.otf,.woff,.woff2" onChange={async (e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!f) return;
        const fam = await uploadFont(f);
        if (fam) set({ family: fam });
      }} />
      <div class="row">
        <GlyphCanvas w={sample.length * (ph / 2) * 3} h={ph * 3} class="gen-preview" draw={(ctx) => {
          [...sample].forEach((ch, i) => drawGlyph(ctx, rasterGlyph(canvasFactory(), ph, ch.charCodeAt(0), o), i * (ph / 2) * 3, 0, 3));
        }} />
      </div>
      <div class="row">
        {progress === null ? (
          <button class="primary small" onClick={() => void run()}>Generate</button>
        ) : (
          <>
            <progress value={progress} max={1} />
            <button class="small" onClick={() => (cancel.current = true)}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

export function FontView({ name }: { name: string }) {
  const s = useStore();
  const data = s.doc!.assets.get(name)!;
  const [h, setH] = useState(24);
  const [code, setCode] = useState(0x41);
  const [text, setText] = useState("Hello 123.4 °C");
  if (!isAsciiLib(data)) {
    return (
      <section class="stage fileview">
        <h2>{name} <span class="muted small">font</span></h2>
        <p>This font isn't an ASCII library (it's probably 8-bit, GBK or Unicode from DWIN's font tool). Its layout isn't documented, so it's kept exactly as it is.</p>
      </section>
    );
  }
  const lib = AsciiFontLib.view(data);
  const w = h / 2;
  const cols = 16;
  const k = Math.max(1, Math.floor(28 / h)) || 1;
  const cellW = w * k + 4, cellH = h * k + 4;
  const rows = Math.ceil(PRINTABLE.length / cols);
  const ek = Math.max(4, Math.floor(320 / h));
  const glyph = lib.glyph(h, code);
  const painting = useRef<number | null>(null);

  return (
    <section class="stage fileview">
      <h2>{name} <span class="muted small">ASCII font library · heights 8–128</span></h2>
      <div class="row">
        <label class="small">Height <select value={h} onChange={(e) => setH(Number(e.currentTarget.value))}>
          {ASCII_HEIGHTS.map((x) => <option key={x} value={x}>{x} ({x / 2}×{x})</option>)}
        </select></label>
        <input value={text} onInput={(e) => setText(e.currentTarget.value)} aria-label="Sample text" />
      </div>
      <GlyphCanvas class="sample" w={Math.max(1, [...text].length * w)} h={h} draw={(ctx) => {
        [...text].forEach((ch, i) => {
          const c = ch.charCodeAt(0);
          if (c < 128) drawGlyph(ctx, lib.glyph(h, c), i * w, 0, 1);
        });
      }} />
      <GlyphCanvas class="glyph-grid" w={cols * cellW} h={rows * cellH}
        draw={(ctx) => PRINTABLE.forEach((c, i) => {
          const x = (i % cols) * cellW + 2, y = Math.floor(i / cols) * cellH + 2;
          if (c === code) {
            ctx.fillStyle = "#2f6fde";
            ctx.fillRect(x - 2, y - 2, cellW, cellH);
          }
          drawGlyph(ctx, lib.glyph(h, c), x, y, k);
        })}
        onPick={(x, y) => {
          const i = Math.floor(y / cellH) * cols + Math.floor(x / cellW);
          const c = PRINTABLE[i];
          if (c !== undefined) setCode(c);
        }} />
      <div class="glyph-edit">
        <div>
          <h3>'{String.fromCharCode(code)}' <span class="muted small">0x{code.toString(16)} · {w}×{h}</span></h3>
          <p class="muted small">Click or drag to paint pixels.</p>
        </div>
        <GlyphCanvas class="glyph-big" w={w * ek} h={h * ek}
          draw={(ctx) => {
            drawGlyph(ctx, glyph, 0, 0, ek);
            ctx.strokeStyle = "rgba(128,128,128,0.35)";
            for (let x = 0; x <= w; x++) { ctx.beginPath(); ctx.moveTo(x * ek, 0); ctx.lineTo(x * ek, h * ek); ctx.stroke(); }
            for (let y = 0; y <= h; y++) { ctx.beginPath(); ctx.moveTo(0, y * ek); ctx.lineTo(w * ek, y * ek); ctx.stroke(); }
          }}
          onPick={(x, y, e) => {
            const px = Math.floor(x / ek), py = Math.floor(y / ek);
            if (px < 0 || py < 0 || px >= w || py >= h) return;
            const i = py * w + px;
            if (e.type === "pointerdown") painting.current = glyph.bits[i] ? 0 : 1;
            const v = painting.current;
            if (v === null || glyph.bits[i] === v) return;
            const g = { ...glyph, bits: glyph.bits.slice() };
            g.bits[i] = v;
            setGlyphIn(name, h, code, g, `glyph:${name}:${h}:${code}`);
          }} />
      </div>
      <Generator name={name} />
    </section>
  );
}

import { useEffect, useRef, useState } from "preact/hooks";
import { moveBy, resizable, setBox } from "../core/controls/geometry";
import type { Rect } from "../core/formats/touch13";
import { from565 } from "../core/formats/rgb565";
import { updateControl } from "../core/project/ops";
import { T5UID1 } from "../core/profile/t5uid1";
import { jumpOf, pageControls, vpHex, type PlacedControl } from "./controls";
import { iconCanvas, iconLibrary, pictureCanvas } from "./render";
import { edit, endGroup, goPage, setState, simChanged, syncSim, useStore } from "./store";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface Drag {
  uid: string;
  kind: "touch" | "display";
  orig: Uint8Array;
  bounds: Rect;
  start: [number, number];
  handle: Handle | null;
  group: string;
  moved: boolean;
}

function resized(b: Rect, h: Handle, dx: number, dy: number): Rect {
  const [xs, ys, xe, ye] = b;
  return [
    h.includes("w") ? xs + dx : xs,
    h.includes("n") ? ys + dy : ys,
    h.includes("e") ? xe + dx : xe,
    h.includes("s") ? ye + dy : ye,
  ];
}

function handlePos(b: Rect, h: Handle): [number, number] {
  const cx = (b[0] + b[2] + 1) / 2, cy = (b[1] + b[3] + 1) / 2;
  const x = h.includes("w") ? b[0] : h.includes("e") ? b[2] + 1 : cx;
  const y = h.includes("n") ? b[1] : h.includes("s") ? b[3] + 1 : cy;
  return [x, y];
}

const css565 = (v: number) => `rgb(${from565(v).join(",")})`;

/** Fixed-width text like the screen's ASCII fonts: `size` high, each
 * character `charW` wide (the browser font is squeezed to fit). */
function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number,
  charW: number | undefined, color: number, align: CanvasTextAlign,
): void {
  ctx.save();
  ctx.fillStyle = css565(color);
  ctx.font = `${size}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const natural = ctx.measureText("0").width || size / 2;
  const sx = charW ? charW / natural : 1;
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function PageCanvas() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  const ref = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<PlacedControl | null>(null);
  const { w, h } = T5UID1.screen;
  const placed = page ? pageControls(doc, page) : [];
  const sim = s.mode === "simulate";

  useEffect(() => {
    const c = ref.current;
    if (!c || !page) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const data = page.background ? doc.assets.get(page.background) : undefined;
    const bg = data && pictureCanvas(data);
    if (bg) ctx.drawImage(bg, 0, 0);
    const drawIcon = (libId: number, id: number, x: number, y: number, transparent: boolean) => {
      const lib = iconLibrary(doc, libId);
      const img = lib && iconCanvas(lib, id, transparent);
      if (img) ctx.drawImage(img, x, y);
    };
    if (sim) {
      for (const d of s.sim.render(page)) {
        if (d.kind === "icon" && d.icon) drawIcon(d.icon.lib, d.icon.id, d.x, d.y, d.icon.transparent);
        if (d.kind === "text" && d.text) {
          ctx.save();
          if (d.box) {
            ctx.beginPath();
            ctx.rect(d.box[0], d.box[1], d.box[2] - d.box[0] + 1, d.box[3] - d.box[1] + 1);
            ctx.clip();
          }
          drawText(ctx, d.text, d.x, d.y, d.size ?? 16, d.charW, d.color ?? 0xffff, d.align ?? "left");
          ctx.restore();
        }
      }
      const pic = (id: number) => {
        const pg = doc.project.pages.find((x) => x.id === id);
        const a = pg?.background ? doc.assets.get(pg.background) : undefined;
        return a ? pictureCanvas(a) : null;
      };
      const o = s.sim.overlay;
      if (o) {
        const src = pic(o.menuPage);
        const cw = o.cut[2] - o.cut[0] + 1, ch = o.cut[3] - o.cut[1] + 1;
        if (src) ctx.drawImage(src, o.cut[0], o.cut[1], cw, ch, o.pos[0], o.pos[1], cw, ch);
        else {
          ctx.fillStyle = "#333";
          ctx.fillRect(o.pos[0], o.pos[1], cw, ch);
        }
      }
      const f = s.sim.flash;
      const fsrc = f && pic(f.page);
      if (f && fsrc) {
        const fw = f.src[2] - f.src[0] + 1, fh = f.src[3] - f.src[1] + 1;
        ctx.drawImage(fsrc, f.src[0], f.src[1], fw, fh, f.dst[0], f.dst[1], fw, fh);
      }
      if (o && o.kind !== "popup") {
        drawText(ctx, o.buffer + "_", o.cursor[0], o.cursor[1], o.fontSize, o.fontSize / 2, o.color || 0xffff,
          o.kind === "number" ? "right" : "left");
      }
    } else if (s.layers.icons) {
      for (const p of placed) {
        const ic = p.info.icon;
        if (ic) drawIcon(ic[0], ic[1], ic[2], ic[3], ic[4]);
      }
    }
  });

  if (!page) return <section class="stage empty muted">No page selected</section>;
  const sel = s.selection;

  const toScreen = (e: PointerEvent | MouseEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    if (!r.width || !r.height) return [e.offsetX ?? 0, e.offsetY ?? 0];
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h];
  };

  const startDrag = (e: PointerEvent, p: PlacedControl, handle: Handle | null) => {
    if (sim || e.button !== 0) return;
    e.stopPropagation();
    setState({ selection: { kind: p.kind, uid: p.control.uid } });
    if (!p.info.bounds) return;
    drag.current = {
      uid: p.control.uid, kind: p.kind, orig: p.bytes, bounds: p.info.bounds, start: toScreen(e),
      handle, group: `drag:${p.control.uid}:${Date.now()}`, moved: false,
    };
    try {
      svg.current?.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toScreen(e);
    const dx = Math.round(x - d.start[0]), dy = Math.round(y - d.start[1]);
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    d.moved = true;
    const bytes = d.handle ? setBox(d.kind, d.orig, resized(d.bounds, d.handle, dx, dy), w, h) : moveBy(d.kind, d.orig, dx, dy, w, h);
    edit((doc) => updateControl(doc, d.uid, bytes), { coalesce: d.group, quiet: true });
  };

  const endDrag = () => {
    drag.current = null;
    endGroup();
  };

  const tap = (e: MouseEvent) => {
    const [x, y] = toScreen(e);
    const r = syncSim().tap(Math.floor(x), Math.floor(y));
    if (s.sim.flash) {
      const f = s.sim.flash;
      setTimeout(() => {
        if (s.sim.flash === f) {
          s.sim.flash = null;
          simChanged();
        }
      }, 180);
    }
    if (r.input) {
      const lim = r.input.min !== null ? ` (${r.input.min / 10 ** r.input.nDot} … ${(r.input.max ?? 0) / 10 ** r.input.nDot})` : "";
      const v = prompt(r.input.kind === "number" ? `Number for VP ${vpHex(r.input.vp)}${lim}` : `Text for VP ${vpHex(r.input.vp)}`);
      if (v !== null) {
        const err = s.sim.enter(r.input, v);
        if (err) alert(err);
      }
    }
    simChanged();
  };

  const box = (r: Rect) => ({ x: r[0], y: r[1], width: Math.max(1, r[2] - r[0] + 1), height: Math.max(1, r[3] - r[1] + 1) });
  const shown = placed.filter((p) => p.info.bounds && (sim ? p.kind === "touch" && !s.sim.overlay : s.layers[p.kind]));
  const selected = placed.find((p) => p.control.uid === sel?.uid);
  const hs = 7 / s.zoom;

  return (
    <section class="stage">
      <div class={`screen${sim ? " simulating" : ""}`} style={{ width: w * s.zoom, height: h * s.zoom }}>
        <canvas ref={ref} width={w} height={h} style={{ width: "100%", height: "100%" }} />
        <svg
          ref={svg} viewBox={`0 0 ${w} ${h}`} class="overlay"
          onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onPointerDown={(e) => !sim && e.target === e.currentTarget && setState({ selection: null })}
          onClick={(e) => sim && tap(e)}
        >
          {shown.map((p) => {
            const isSel = sel?.uid === p.control.uid;
            const j = jumpOf(doc, p.info);
            const title = `${p.info.typeName}  VP ${vpHex(p.info.vp)}${j ? `  → page ${j.page}${j.via === "host" ? " (host)" : ""}${sim ? "" : " (double-click)"}` : ""}`;
            return (
              <rect
                key={p.control.uid}
                {...box(p.info.bounds!)}
                class={sim ? "ctl sim" : `ctl ${p.kind}${isSel ? " sel" : ""}${p.info.estimated ? " est" : ""}`}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover((x) => (x === p ? null : x))}
                onPointerDown={(e) => startDrag(e, p, null)}
                onDblClick={() => {
                  const to = j?.page;
                  if (!sim && to !== undefined && doc.project.pages.some((pg) => pg.id === to)) goPage(to);
                }}
              >
                <title>{title}</title>
              </rect>
            );
          })}
          {!sim && selected?.info.bounds && resizable(selected.kind, selected.bytes) &&
            HANDLES.map((hd) => {
              const [x, y] = handlePos(selected.info.bounds!, hd);
              return (
                <rect
                  key={hd} class={`handle h-${hd}`} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs}
                  onPointerDown={(e) => startDrag(e, selected, hd)}
                />
              );
            })}
        </svg>
      </div>
      <p class="muted small status">
        Page {page.id} · {page.background ?? "no picture"} ·{" "}
        {hover
          ? `${hover.info.typeName} — VP ${vpHex(hover.info.vp)}${hover.info.estimated ? " (size estimated)" : ""}`
          : sim
            ? s.sim.overlay
              ? `${s.sim.overlay.kind === "popup" ? "Popup menu" : "Keypad"} open (page ${s.sim.overlay.menuPage}): click its keys; touches outside are ignored`
              : "Simulating: click buttons; VP values are in the panel on the right"
            : "Drag to move, handles to resize, arrows to nudge (Shift ×10), Del to delete, Ctrl+D duplicate, Ctrl+Z undo"}
      </p>
    </section>
  );
}

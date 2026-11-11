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
          ctx.fillStyle = css565(d.color ?? 0xffff);
          ctx.font = `${d.size ?? 16}px ui-monospace, monospace`;
          ctx.textBaseline = "top";
          ctx.textAlign = d.align ?? "left";
          ctx.fillText(d.text, d.x, d.y);
          ctx.restore();
        }
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

  const press = (e: MouseEvent, p: PlacedControl) => {
    const [x, y] = toScreen(e);
    const r = syncSim().press(p.bytes, x, y);
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
  const shown = placed.filter((p) => p.info.bounds && (sim ? p.kind === "touch" : s.layers[p.kind]));
  const selected = placed.find((p) => p.control.uid === sel?.uid);
  const hs = 7 / s.zoom;

  return (
    <section class="stage">
      <div class={`screen${sim ? " simulating" : ""}`} style={{ width: w * s.zoom, height: h * s.zoom }}>
        <canvas ref={ref} width={w} height={h} style={{ width: "100%", height: "100%" }} />
        <svg
          ref={svg} viewBox={`0 0 ${w} ${h}`} class="overlay"
          onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onPointerDown={(e) => e.target === e.currentTarget && setState({ selection: null })}
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
                onClick={(e) => sim && press(e, p)}
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
            ? "Simulating: click buttons; VP values are in the panel on the right"
            : "Drag to move, handles to resize, arrows to nudge (Shift ×10), Del to delete, Ctrl+D duplicate, Ctrl+Z undo"}
      </p>
    </section>
  );
}

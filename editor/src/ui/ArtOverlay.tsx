// Picture mode on the canvas: pick, move and resize layers, draw new
// shapes by dragging, paint strokes, pick colours.
import { useRef } from "preact/hooks";
import { hasBox, layerBox, moveLayer, newLayer, setLayerBox, type Box, type Layer, type PaintLayer } from "../core/art/schema";
import { Bitmap } from "../core/formats/bmp";
import { T5UID1 } from "../core/profile/t5uid1";
import { artEdit, setLayer, toHex } from "./artCommands";
import { endGroup, getState, setState, useStore } from "./store";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "p1" | "p2";
const BOX_HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

interface Drag {
  kind: "move" | "resize" | "create" | "stroke";
  id: string;
  orig: Layer;
  start: [number, number];
  handle: Handle | null;
  group: string;
  moved: boolean;
}

function resizeBox(b: Box, h: Handle, dx: number, dy: number): Box {
  let [x, y, w, hh] = b;
  if (h.includes("w")) { x += dx; w -= dx; }
  if (h.includes("e")) w += dx;
  if (h.includes("n")) { y += dy; hh -= dy; }
  if (h.includes("s")) hh += dy;
  return [x, y, w, hh];
}

function handleXY(b: Box, h: Handle): [number, number] {
  const [x, y, w, hh] = b;
  return [h.includes("w") ? x : h.includes("e") ? x + w : x + w / 2, h.includes("n") ? y : h.includes("s") ? y + hh : y + hh / 2];
}

/** Topmost visible, unlocked layer under (x, y). */
export function pickLayer(layers: Layer[], x: number, y: number): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (!l.visible || l.locked) continue;
    const b = layerBox(l);
    if (b && x >= b[0] && y >= b[1] && x <= b[0] + b[2] && y <= b[1] + b[3]) return l;
  }
  return null;
}

export function ArtOverlay() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const { w, h } = T5UID1.screen;
  if (!page) return null;
  const art = page.art;
  const sel = art?.layers.find((l) => l.id === s.layerId) ?? null;

  const pos = (e: PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    if (!r.width) return [0, 0];
    return [Math.round(((e.clientX - r.left) / r.width) * w), Math.round(((e.clientY - r.top) / r.height) * h)];
  };
  const capture = (e: PointerEvent) => {
    try {
      svg.current?.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
  };

  const down = (e: PointerEvent, handle: Handle | null = null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const [x, y] = pos(e);
    const tool = getState().tool;
    const group = `art:${Date.now()}`;
    if (handle && sel) {
      drag.current = { kind: "resize", id: sel.id, orig: sel, start: [x, y], handle, group, moved: false };
      return capture(e);
    }
    if (tool === "eyedropper") {
      const data = page.background ? doc.assets.get(page.background) : undefined;
      if (data) setState({ brush: { ...getState().brush, color: toHex(Bitmap.load(data).get(Math.min(w - 1, x), Math.min(h - 1, y))) } });
      return;
    }
    if (tool === "text") {
      const l = { ...newLayer("text", { x, y }) } as Layer;
      artEdit((a) => void a.layers.push(l));
      setState({ layerId: l.id, tool: "select" });
      return;
    }
    if (tool === "rect" || tool === "ellipse" || tool === "line") {
      const l = newLayer(tool, { x, y, w: 1, h: 1 });
      const ll = l.type === "line" ? { ...l, x2: x, y2: y } : l;
      artEdit((a) => void a.layers.push(ll), { coalesce: group });
      setState({ layerId: ll.id });
      drag.current = { kind: "create", id: ll.id, orig: ll, start: [x, y], handle: null, group, moved: false };
      return capture(e);
    }
    if (tool === "brush" || tool === "eraser") {
      const b = getState().brush;
      const stroke = { points: [x, y], color: b.color, width: b.width, erase: tool === "eraser" };
      let id = sel?.type === "paint" && sel.visible && !sel.locked ? sel.id : null;
      artEdit((a) => {
        let p = a.layers.find((l) => l.id === id) as PaintLayer | undefined;
        if (!p) {
          p = newLayer("paint") as PaintLayer;
          a.layers.push(p);
          id = p.id;
        }
        p.strokes.push(stroke);
      }, { coalesce: group });
      setState({ layerId: id });
      drag.current = { kind: "stroke", id: id!, orig: sel!, start: [x, y], handle: null, group, moved: true };
      return capture(e);
    }
    // select tool: pick and start moving
    const hit = pickLayer(art?.layers ?? [], x, y);
    setState({ layerId: hit?.id ?? null });
    if (hit) {
      drag.current = { kind: "move", id: hit.id, orig: hit, start: [x, y], handle: null, group, moved: false };
      capture(e);
    }
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = pos(e);
    const dx = x - d.start[0], dy = y - d.start[1];
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    d.moved = true;
    const opts = { coalesce: d.group, quiet: true };
    if (d.kind === "move") setLayer(d.id, () => moveLayer(d.orig, dx, dy), opts);
    else if (d.kind === "create" || (d.kind === "resize" && d.orig.type === "line")) {
      setLayer(d.id, (l) => {
        if (l.type === "line") {
          if (d.kind === "resize" && d.handle === "p1") return { ...l, x1: (d.orig as typeof l).x1 + dx, y1: (d.orig as typeof l).y1 + dy };
          if (d.kind === "resize") return { ...l, x2: (d.orig as typeof l).x2 + dx, y2: (d.orig as typeof l).y2 + dy };
          return { ...l, x2: x, y2: y };
        }
        return setLayerBox(l, [d.start[0], d.start[1], dx, dy]);
      }, opts);
    } else if (d.kind === "resize") {
      setLayer(d.id, () => setLayerBox(d.orig, resizeBox(layerBox(d.orig)!, d.handle!, dx, dy)), opts);
    } else if (d.kind === "stroke") {
      artEdit((a) => {
        const p = a.layers.find((l) => l.id === d.id) as PaintLayer | undefined;
        p?.strokes.at(-1)?.points.push(x, y);
      }, opts);
    }
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "create") {
      // a click without dragging makes a default-size shape
      if (!d.moved) {
        const def = newLayer(d.orig.type, { x: d.start[0], y: d.start[1] });
        setLayer(d.id, (l) => ({ ...def, id: l.id }) as Layer, { coalesce: d.group, quiet: true });
      }
      setState({ tool: "select" });
    }
    endGroup();
  };

  const box = sel ? layerBox(sel) : null;
  const hs = 7 / s.zoom;
  const cursor = s.tool === "select" ? "default" : s.tool === "eyedropper" ? "copy" : "crosshair";

  return (
    <svg
      ref={svg} viewBox={`0 0 ${w} ${h}`} class="overlay art" style={{ cursor }}
      onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    >
      {box && sel && (
        <>
          <rect class="layer-box" x={box[0]} y={box[1]} width={Math.max(1, box[2])} height={Math.max(1, box[3])} />
          {!sel.locked && hasBox(sel) && BOX_HANDLES.map((hd) => {
            const [hx, hy] = handleXY(box, hd);
            return <rect key={hd} class={`handle h-${hd}`} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs}
              onPointerDown={(e) => down(e, hd)} />;
          })}
          {!sel.locked && sel.type === "line" && (["p1", "p2"] as const).map((hd) => {
            const [hx, hy] = hd === "p1" ? [sel.x1, sel.y1] : [sel.x2, sel.y2];
            return <rect key={hd} class="handle" x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs}
              onPointerDown={(e) => down(e, hd)} />;
          })}
        </>
      )}
    </svg>
  );
}

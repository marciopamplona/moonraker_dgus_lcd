import { useEffect, useRef, useState } from "preact/hooks";
import type { Rect } from "../core/formats/touch13";
import { T5UID1 } from "../core/profile/t5uid1";
import { pageControls, vpHex, type PlacedControl } from "./controls";
import { iconCanvas, iconLibrary, pictureCanvas } from "./render";
import { setState, useStore } from "./store";

export function PageCanvas() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<PlacedControl | null>(null);
  const { w, h } = T5UID1.screen;
  const placed = page ? pageControls(doc, page) : [];

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
    if (s.layers.icons) {
      for (const p of placed) {
        const ic = p.info.icon;
        if (!ic) continue;
        const lib = iconLibrary(doc, ic[0]);
        const img = lib && iconCanvas(lib, ic[1], ic[4]);
        if (img) ctx.drawImage(img, ic[2], ic[3]);
      }
    }
  });

  if (!page) return <section class="stage empty muted">No page selected</section>;
  const sel = s.selection;
  const box = (r: Rect) => ({ x: r[0], y: r[1], width: Math.max(1, r[2] - r[0] + 1), height: Math.max(1, r[3] - r[1] + 1) });
  const shown = placed.filter((p) => p.info.bounds && s.layers[p.kind]);

  return (
    <section class="stage">
      <div class="screen" style={{ width: w * s.zoom, height: h * s.zoom }}>
        <canvas ref={ref} width={w} height={h} style={{ width: "100%", height: "100%" }} />
        <svg
          viewBox={`0 0 ${w} ${h}`} class="overlay"
          onClick={(e) => e.target === e.currentTarget && setState({ selection: null })}
        >
          {shown.map((p) => {
            const isSel = sel?.uid === p.control.uid;
            return (
              <rect
                key={p.control.uid}
                {...box(p.info.bounds!)}
                class={`ctl ${p.kind}${isSel ? " sel" : ""}${p.info.estimated ? " est" : ""}`}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover((x) => (x === p ? null : x))}
                onClick={() => setState({ selection: { kind: p.kind, uid: p.control.uid } })}
                onDblClick={() => {
                  const to = p.info.jumpTo;
                  if (to !== null && doc.project.pages.some((pg) => pg.id === to)) setState({ pageId: to, selection: null });
                }}
              >
                <title>{`${p.info.typeName}  VP ${vpHex(p.info.vp)}${p.info.jumpTo !== null ? `  → page ${p.info.jumpTo} (double-click)` : ""}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <p class="muted small status">
        Page {page.id} · {page.background ?? "no picture"} ·{" "}
        {hover ? `${hover.info.typeName} — VP ${vpHex(hover.info.vp)}${hover.info.estimated ? " (size estimated)" : ""}` : "hover a control; double-click a button to follow its page jump"}
      </p>
    </section>
  );
}

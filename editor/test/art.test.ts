import { describe, expect, it } from "vitest";
import {
  Bitmap, addArtFont, blankProject, compile, createPressedVariant, decompile, editArt, ensureArt, equal,
  flattenPage, fromHex, getPage, layerBox, moveLayer, newLayer, pruneArtAssets, quantize565, readHead,
  reorderLayer, removeLayer, duplicateLayer, setLayerBox, returnKey, addControl, type Layer, type RectLayer,
} from "../src/core";
import { loadDgusproj, saveDgusproj } from "../src/io/dgusproj";
import { pickDwinSet } from "../src/io/dwinset";
import { registerTestFont, testEnv } from "./artenv";
import { VENDOR_SET, list, read } from "./util";

const px = (doc: ReturnType<typeof blankProject>, page: number, x: number, y: number) =>
  Bitmap.load(doc.assets.get(getPage(doc, page).background!)!).get(x, y);

function paint(layers: Layer[], opts: { dither?: boolean; background?: string } = {}) {
  const doc = blankProject();
  const env = testEnv(doc);
  editArt(doc, 0, env, (a) => {
    a.layers = [];
    a.background = opts.background ?? "#000000";
    a.dither = opts.dither ?? false;
    a.layers.push(...layers);
  });
  return doc;
}

describe("artwork rendering", () => {
  it("rect fill, rounded corners and inner stroke", () => {
    const r = { ...newLayer("rect", { x: 10, y: 10, w: 100, h: 50 }), fill: "#ff0000", radius: 10, stroke: "#00ff00", strokeWidth: 4 } as RectLayer;
    const doc = paint([r]);
    expect(px(doc, 0, 60, 35)).toEqual([255, 0, 0]);
    expect(px(doc, 0, 60, 11)).toEqual([0, 255, 0]); // stroke inside the top edge
    expect(px(doc, 0, 60, 8)).toEqual([0, 0, 0]); // nothing outside the box
    expect(px(doc, 0, 10, 10)).toEqual([0, 0, 0]); // rounded corner
  });

  it("vertical gradient goes from fill to `to`", () => {
    const r = { ...newLayer("rect", { x: 0, y: 0, w: 480, h: 272 }), radius: 0, fill: "#000000", gradient: { to: "#ffffff", dir: "v" } } as RectLayer;
    const doc = paint([r]);
    const top = px(doc, 0, 100, 1)[0], mid = px(doc, 0, 100, 136)[0], bottom = px(doc, 0, 100, 270)[0];
    expect(top).toBeLessThan(5);
    expect(Math.abs(mid - 128)).toBeLessThan(6);
    expect(bottom).toBeGreaterThan(250);
  });

  it("ellipse, line, opacity", () => {
    const e = { ...newLayer("ellipse", { x: 100, y: 100, w: 40, h: 40 }), fill: "#0000ff" } as Layer;
    const l = { ...newLayer("line", { x: 0, y: 200, w: 479, h: 0 }), color: "#ffffff", width: 4 } as Layer;
    const half = { ...newLayer("rect", { x: 300, y: 20, w: 50, h: 50 }), radius: 0, fill: "#ffffff", opacity: 0.5 } as Layer;
    const doc = paint([e, l, half]);
    expect(px(doc, 0, 120, 120)).toEqual([0, 0, 255]);
    expect(px(doc, 0, 101, 101)).toEqual([0, 0, 0]);
    expect(px(doc, 0, 240, 200)).toEqual([255, 255, 255]);
    expect(Math.abs(px(doc, 0, 320, 40)[0] - 128)).toBeLessThan(3);
  });

  it("text renders with an uploaded font", () => {
    const fam = registerTestFont();
    const t = { ...newLayer("text", { x: 20, y: 20 }), text: "HELLO", font: fam, size: 40, color: "#ffffff" } as Layer;
    const doc = paint([t]);
    const bm = Bitmap.load(doc.assets.get(getPage(doc, 0).background!)!);
    let ink = 0;
    for (let y = 20; y < 70; y++) for (let x = 20; x < 200; x++) if (bm.get(x, y)[0] > 128) ink++;
    expect(ink).toBeGreaterThan(300);
    expect(bm.get(300, 100)).toEqual([0, 0, 0]);
  });

  it("paint strokes and the eraser only affect their own layer", () => {
    const under = { ...newLayer("rect", { x: 0, y: 0, w: 480, h: 272 }), radius: 0, fill: "#203040" } as Layer;
    const p = { ...newLayer("paint"), strokes: [
      { points: [50, 50, 200, 50], color: "#ffff00", width: 10, erase: false },
      { points: [120, 40, 120, 60], color: "#000", width: 10, erase: true },
    ] } as Layer;
    const doc = paint([under, p]);
    expect(px(doc, 0, 60, 50)).toEqual([255, 255, 0]);
    expect(px(doc, 0, 120, 50)).toEqual([0x20, 0x30, 0x40]); // erased paint shows the rect below
  });

  it("dither quantises to RGB565 and breaks up flat mid-tones", () => {
    const flat = { ...newLayer("rect", { x: 0, y: 0, w: 480, h: 272 }), radius: 0, fill: "#7b7b7b" } as Layer;
    const doc = paint([flat], { dither: true });
    const bm = Bitmap.load(doc.assets.get(getPage(doc, 0).background!)!);
    const levels = new Set<string>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) levels.add(bm.get(x, y).join());
    expect(levels.size).toBeGreaterThan(1);
    for (const l of levels) {
      const [r, g] = l.split(",").map(Number);
      expect(r! & 0x07).toBe(r! >> 5); // replicated 5-bit level
      expect(g! & 0x03).toBe(g! >> 6); // replicated 6-bit level
    }
    const a = new Uint8ClampedArray([0x7b, 0x7b, 0x7b, 255]);
    quantize565(a, 1, 1, false);
    expect([...a.slice(0, 3)]).toEqual([0x7b, 0x79, 0x7b]);
  });
});

describe("artwork on imported pages", () => {
  const vendor = () => decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;

  it("the original picture becomes a locked base layer and flattens to the same pixels", () => {
    const doc = vendor();
    const before = Bitmap.load(doc.assets.get(getPage(doc, 1).background!)!);
    const art = ensureArt(doc, 1);
    expect(art.layers).toHaveLength(1);
    expect(art.layers[0]).toMatchObject({ type: "image", locked: true, x: 0, y: 0, w: 480, h: 272 });
    flattenPage(doc, 1, testEnv(doc));
    const after = Bitmap.load(doc.assets.get(getPage(doc, 1).background!)!);
    expect(equal(after.px, before.px)).toBe(true);
  });

  it("only edited pages change; art assets aren't exported", () => {
    const doc = vendor();
    const files = compile(doc);
    editArt(doc, 1, testEnv(doc), (a) => a.layers.push({ ...newLayer("rect", { x: 0, y: 0, w: 10, h: 10 }), fill: "#ff0000" } as Layer));
    const out = compile(doc);
    expect([...out.keys()].sort()).toEqual([...files.keys()].sort());
    const changed = [...out].filter(([k, v]) => !equal(v, files.get(k)!)).map(([k]) => k);
    expect(changed).toEqual(["001_home.bmp"]);
    expect([...doc.assets.keys()].filter((k) => k.startsWith("art/")).length).toBe(1);
  });

  it("artwork survives .dgusproj", () => {
    const doc = vendor();
    editArt(doc, 1, testEnv(doc), (a) => a.layers.push(newLayer("text")));
    const back = loadDgusproj(saveDgusproj(doc));
    expect(getPage(back, 1).art).toEqual(getPage(doc, 1).art);
    expect([...back.assets.keys()].filter((k) => k.startsWith("art/"))).toEqual([...doc.assets.keys()].filter((k) => k.startsWith("art/")));
  });
});

describe("artwork operations", () => {
  it("layer ops: reorder, duplicate, remove, move, box", () => {
    const doc = blankProject();
    const env = testEnv(doc);
    let ids: string[] = [];
    editArt(doc, 0, env, (a) => {
      a.layers.push(newLayer("rect"), newLayer("ellipse"), newLayer("text"));
      ids = a.layers.map((l) => l.id);
    });
    const art = getPage(doc, 0).art!;
    const [base, r, e, t] = ids;
    expect(art.layers[0]!.name).toBe("Original picture");
    reorderLayer(art, r!, +5);
    expect(art.layers.at(-1)!.id).toBe(r);
    const copy = duplicateLayer(art, e!);
    expect(art.layers.map((l) => l.id)).toEqual([base, e, copy, t, r]);
    removeLayer(art, copy);
    const moved = moveLayer(art.layers.find((l) => l.id === r)!, 5, -5);
    expect(layerBox(moved)!.slice(0, 2)).toEqual([45, 35]);
    expect(layerBox(setLayerBox(moved, [100, 100, -20, 30]))).toEqual([80, 100, 20, 30]);
    const line = moveLayer(newLayer("line", { x: 0, y: 0, w: 10, h: 0 }), 3, 4);
    expect(line).toMatchObject({ x1: 3, y1: 4, x2: 13, y2: 4 });
  });

  it("fonts are kept as art assets with unique families; unused assets are pruned", () => {
    const doc = blankProject();
    const a = addArtFont(doc, "My Font", new Uint8Array([1, 2]));
    const b = addArtFont(doc, "My Font", new Uint8Array([3]));
    expect([a, b]).toEqual(["My Font", "My Font 2"]);
    doc.assets.set("art/orphan.png", new Uint8Array(1));
    pruneArtAssets(doc);
    expect(doc.assets.has("art/orphan.png")).toBe(false);
    expect(doc.project.artFonts!.every((f) => doc.assets.has(f.asset))).toBe(true);
  });

  it("pressed variant: copy of the page, linked as Pic_On of its buttons", () => {
    const doc = blankProject();
    addControl(doc, 0, "touch", returnKey(0, [10, 10, 50, 50], 0x1000, 1));
    editArt(doc, 0, testEnv(doc), (a) => a.layers.push(newLayer("rect")));
    const sel = createPressedVariant(doc, 0);
    expect(sel).toMatchObject({ id: 1, name: "main_sel", background: "001_main_sel.bmp" });
    expect(sel.art!.layers.map((l) => l.type)).toEqual(getPage(doc, 0).art!.layers.map((l) => l.type));
    expect(sel.art!.layers[0]!.id).not.toBe(getPage(doc, 0).art!.layers[0]!.id);
    expect(readHead(fromHex(getPage(doc, 0).touch[0]!.bytes)).picOn).toBe(1);
    expect(equal(doc.assets.get(sel.background!)!, doc.assets.get(getPage(doc, 0).background!)!)).toBe(true);
  });
});

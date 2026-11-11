// @vitest-environment happy-dom
// Picture mode through the real UI, with @napi-rs/canvas standing in for
// the browser's canvas (happy-dom has none) so flattening renders pixels.
import "fake-indexeddb/auto";
import { createCanvas } from "@napi-rs/canvas";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bitmap, blankProject, fromHex, getPage, readHead, returnKey, addControl, newLayer, type ImageLayer } from "../src/core";
import { App } from "../src/ui/App";
import { setCanvasFactory } from "../src/ui/artEnv";
import { getState, openDoc, setState } from "../src/ui/store";

let root: HTMLDivElement;

beforeEach(async () => {
  setCanvasFactory((w, h) => createCanvas(w, h) as never);
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 480, bottom: 272, width: 480, height: 272, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  setState({ layers: { touch: true, display: true, icons: true }, mode: "edit", panel: "inspect", tool: "select", layerId: null, preview565: false });
  root = document.createElement("div");
  document.body.append(root);
  await act(() => render(<App />, root));
});

afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
});

const fire = (el: Element | null | undefined, ev: Event) => act(() => void el!.dispatchEvent(ev));
const pointer = (type: string, x: number, y: number) =>
  fire(root.querySelector("svg.overlay.art"), new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
const dragOn = async (x0: number, y0: number, x1: number, y1: number) => {
  await pointer("pointerdown", x0, y0);
  await pointer("pointermove", (x0 + x1) / 2, (y0 + y1) / 2);
  await pointer("pointermove", x1, y1);
  await pointer("pointerup", x1, y1);
};
const click = (el: Element | null | undefined) => fire(el, new MouseEvent("click", { bubbles: true }));
const btn = (text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);
const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts })));
const pixel = (x: number, y: number, page = 0) => {
  const doc = getState().doc!;
  return Bitmap.load(doc.assets.get(getPage(doc, page).background!)!).get(x, y);
};
const art = () => getPage(getState().doc!, getState().pageId!).art;

describe("picture mode", () => {
  it("draw a rectangle, move it, undo; the page BMP follows", async () => {
    await act(() => openDoc(blankProject("Pic"), [], false));
    await click(btn("Picture"));
    expect(getState().mode).toBe("picture");
    expect(root.textContent).toContain("no layers yet");
    expect(pixel(50, 30)).toEqual([255, 255, 255]);

    await click(btn("Rectangle (R)"));
    await dragOn(10, 10, 110, 60);
    expect(art()!.layers.map((l) => l.type)).toEqual(["image", "rect"]);
    expect(art()!.layers[0]).toMatchObject({ locked: true, name: "Original picture" });
    expect(art()!.layers[1]).toMatchObject({ x: 10, y: 10, w: 100, h: 50 });
    expect(pixel(50, 30)).toEqual([0x2f, 0x6f, 0xde]);
    expect(getState().tool).toBe("select");
    expect(getState().past.length).toBe(1); // creating by dragging is one undo step

    await dragOn(60, 35, 80, 45); // move by (20, 10)
    expect(art()!.layers[1]).toMatchObject({ x: 30, y: 20 });
    expect(pixel(15, 15)).toEqual([255, 255, 255]);
    expect(pixel(125, 65)).toEqual([0x2f, 0x6f, 0xde]);

    await key("z", { ctrlKey: true });
    expect(art()!.layers[1]).toMatchObject({ x: 10, y: 10 });
    expect(pixel(15, 15)).toEqual([0x2f, 0x6f, 0xde]);

    // arrows nudge the selected layer, Delete removes it
    await key("ArrowRight", { shiftKey: true });
    expect(art()!.layers[1]).toMatchObject({ x: 20 });
    await key("Delete");
    expect(art()!.layers.length).toBe(1);
    expect(pixel(50, 30)).toEqual([255, 255, 255]);
  });

  it("brush, eyedropper, layer properties, hotkeys", async () => {
    await act(() => openDoc(blankProject("Paint"), [], false));
    await click(btn("Picture"));
    setState({ brush: { color: "#ff0000", width: 8 } });
    await key("b");
    expect(getState().tool).toBe("brush");
    await dragOn(100, 100, 200, 100);
    expect(art()!.layers.at(-1)).toMatchObject({ type: "paint" });
    expect(pixel(150, 100)).toEqual([255, 0, 0]);

    await key("i");
    setState({ brush: { color: "#000000", width: 8 } });
    await pointer("pointerdown", 150, 100);
    await pointer("pointerup", 150, 100);
    expect(getState().brush.color).toBe("#ff0000");

    // add a text layer from the panel and change its colour
    const add = root.querySelector<HTMLSelectElement>('select[aria-label="Add layer"]')!;
    await act(() => {
      add.value = "text";
      add.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(art()!.layers.at(-1)!.type).toBe("text");
    const name = [...root.querySelectorAll<HTMLInputElement>(".props input")].find((i) => i.value === "Text")!;
    await act(() => {
      name.value = "Title";
      name.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(art()!.layers.at(-1)!.name).toBe("Title");
    expect(root.querySelector(".layers")!.textContent).toContain("Title");
  });

  it("pressed variant becomes Pic_On of the page's buttons", async () => {
    const doc = blankProject("Pressed");
    addControl(doc, 0, "touch", returnKey(0, [10, 10, 60, 40], 0x1000, 1));
    await act(() => openDoc(doc, [], false));
    await click(btn("Picture"));
    await click(btn("Create pressed variant"));
    expect(getState().pageId).toBe(1);
    const d = getState().doc!;
    expect(getPage(d, 1).name).toBe("main_sel");
    expect(readHead(fromHex(getPage(d, 0).touch[0]!.bytes)).picOn).toBe(1);
    // editing the variant doesn't touch the original
    await click(btn("Ellipse (O)"));
    await dragOn(200, 100, 260, 160);
    expect(pixel(230, 130, 1)).not.toEqual([255, 255, 255]);
    expect(pixel(230, 130, 0)).toEqual([255, 255, 255]);
    await click(btn("Controls"));
    expect(getState().mode).toBe("edit");
  });

  it("image layers keep their aspect ratio by default; Shift or the checkbox frees them", async () => {
    const doc = blankProject("Aspect");
    const src = new Bitmap(40, 20);
    src.px.fill(200);
    doc.assets.set("art/test.bmp", src.save());
    await act(() => openDoc(doc, [], false));
    await click(btn("Picture"));
    const img = { ...newLayer("image", { x: 100, y: 100, w: 80, h: 40 }), asset: "art/test.bmp", ratio: 2 } as ImageLayer;
    const { artEdit } = await import("../src/ui/artCommands");
    await act(() => {
      artEdit((a) => void a.layers.push(img));
      setState({ layerId: img.id });
    });
    const layer = () => art()!.layers.find((l) => l.id === img.id) as ImageLayer;
    const handle = (cls: string) => root.querySelector(`svg.overlay.art rect.handle.h-${cls}`)!;
    const dragHandle = async (cls: string, x0: number, y0: number, x1: number, y1: number, shiftKey = false) => {
      await fire(handle(cls), new PointerEvent("pointerdown", { bubbles: true, clientX: x0, clientY: y0, button: 0, pointerId: 1 }));
      await fire(root.querySelector("svg.overlay.art"), new PointerEvent("pointermove", { bubbles: true, clientX: x1, clientY: y1, pointerId: 1, shiftKey }));
      await pointer("pointerup", x1, y1);
    };
    const aspectBox = () => [...root.querySelectorAll("label.prop")].find((l) => l.textContent?.includes("Fixed aspect ratio"))!
      .querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(aspectBox().checked).toBe(true);

    await dragHandle("se", 180, 140, 220, 140); // widen by 40 -> 120 x 60
    expect([layer().x, layer().y, layer().w, layer().h]).toEqual([100, 100, 120, 60]);
    await dragHandle("s", 160, 160, 160, 190); // taller by 30 -> 180 x 90, centred
    expect([layer().w, layer().h]).toEqual([180, 90]);
    expect(layer().x).toBe(70);

    await dragHandle("e", 250, 145, 270, 145, true); // Shift: free
    expect([layer().w, layer().h]).toEqual([200, 90]);

    // untick: free resizing, W no longer drives H
    const box = aspectBox();
    await act(() => {
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(layer().keepAspect).toBe(false);
    await dragHandle("se", 270, 190, 300, 200);
    expect([layer().w, layer().h]).toEqual([230, 100]);
    const wInput = [...root.querySelectorAll<HTMLInputElement>(".props .grid4 input")][2]!;
    await act(() => {
      wInput.value = "100";
      wInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect([layer().w, layer().h]).toEqual([100, 100]);

    // tick again: W drives H with the image's natural ratio (2:1)
    await act(() => {
      const b = aspectBox();
      b.checked = true;
      b.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const w2 = [...root.querySelectorAll<HTMLInputElement>(".props .grid4 input")][2]!;
    await act(() => {
      w2.value = "160";
      w2.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect([layer().w, layer().h]).toEqual([160, 80]);
  });
});

// @vitest-environment happy-dom
// M4 through the UI: icon libraries, renaming with references, NAND
// warnings, CFG and 22*.BIN forms, fonts (paint + generate from a TTF).
import "fake-indexeddb/auto";
import { createCanvas } from "@napi-rs/canvas";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AsciiFontLib, IconLibrary, SramInit, countLibRefs, decompile, equal, getCfg, type ProjectDoc } from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { App } from "../src/ui/App";
import { setCanvasFactory } from "../src/ui/artEnv";
import { getState, openDoc, setState } from "../src/ui/store";
import { registerTestFont } from "./artenv";
import { VENDOR_SET, list, read } from "./util";

let root: HTMLDivElement;
let vendorDoc: ProjectDoc | null = null;
const vendor = () => (vendorDoc ??= decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)])), "Vendor").doc);

beforeEach(async () => {
  setCanvasFactory((w, h) => createCanvas(w, h) as never);
  Element.prototype.getBoundingClientRect = function () {
    const w = Number(this.getAttribute?.("width")) || 480, h = Number(this.getAttribute?.("height")) || 272;
    return { left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  window.confirm = () => true;
  setState({ mode: "edit", file: null });
  root = document.createElement("div");
  document.body.append(root);
  await act(() => render(<App />, root));
  await act(() => openDoc(vendor(), [], false));
});

afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
});

const fire = (el: Element | null | undefined, ev: Event) => act(() => void el!.dispatchEvent(ev));
const click = (el: Element | null | undefined) => fire(el, new MouseEvent("click", { bubbles: true }));
const btn = (text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const fileBtn = (name: string) => [...root.querySelectorAll("button.file")].find((b) => b.textContent?.includes(name));
const change = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement || el.type === "checkbox" ? "change" : "input", { bubbles: true }));
    if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event("change", { bubbles: true }));
  });
const doc = () => getState().doc!;

describe("files", () => {
  it("icon library: browse, rename (updates controls), delete an icon", async () => {
    await click(fileBtn("24_icons.ico"));
    expect(getState().file).toBe("24_icons.ico");
    expect(root.querySelectorAll(".icon-cell").length).toBe(5);
    expect(root.textContent).toContain("used ");
    const refs = countLibRefs(doc(), 24);
    expect(root.querySelector(".inspector")!.textContent).toContain(`${refs} control field(s)`);

    await change(root.querySelector<HTMLInputElement>('input[aria-label="File id"]')!, "62");
    await click(btn("Rename"));
    expect(getState().file).toBe("62_icons.ico");
    expect(countLibRefs(doc(), 62)).toBe(refs);

    await click(root.querySelectorAll(".icon-cell")[4]);
    expect(root.textContent).toContain("Icon 4");
    await click(btn("Delete") && [...root.querySelectorAll(".icon-detail button")].find((b) => b.textContent === "Delete"));
    expect(IconLibrary.parse(doc().assets.get("62_icons.ico")!).icons.has(4)).toBe(false);
  });

  it("NAND: a new icon library placed over another file is flagged", async () => {
    const add = root.querySelector<HTMLSelectElement>('select[aria-label="Add file"]')!;
    await change(add, "icons");
    const name = getState().file!;
    expect(root.querySelectorAll(".sidebar .bad").length).toBe(0);
    await change(root.querySelector<HTMLInputElement>('input[aria-label="File id"]')!, "31");
    await click(btn("Rename"));
    expect(root.querySelector(".sidebar .bad")!.textContent).toMatch(/31_icons\.ico .*overlaps|overlaps 31_icons\.ico/);
    expect(name).toMatch(/_icons\.ico$/);
  });

  it("CFG and 22*.BIN forms", async () => {
    await click(fileBtn("T5UID1.CFG"));
    const rot = [...root.querySelectorAll("label.prop")].find((l) => l.textContent?.startsWith("Rotation"))!.querySelector("select")!;
    await change(rot, "180");
    expect(getCfg(doc())!.rotation).toBe(180);
    const baud = [...root.querySelectorAll("label.prop")].find((l) => l.textContent?.startsWith("Baud"))!.querySelector("select")!;
    await change(baud, String([...baud.options].find((o) => o.textContent?.startsWith("250000"))!.value));
    expect(getCfg(doc())!.baudValue).toBe(31); // 00 1F, like screen/cfg/T5UID1.CFG

    await click(fileBtn("22_config.bin"));
    const [vp, val] = root.querySelectorAll<HTMLInputElement>(".sram-form input.mono");
    await change(vp!, "0x3000");
    await change(val!, "5 0x10");
    await click(btn("Set"));
    expect(SramInit.parse(doc().assets.get("22_config.bin")!).runs()).toEqual([{ vp: 0x3000, words: [5, 0x10] }]);
    expect(root.querySelector(".sram tbody")!.textContent).toContain("0x3000");
  });

  it("new font: paint a pixel, then generate height 16 from a TTF", async () => {
    const fam = registerTestFont();
    await act(() => setState({ doc: { ...doc(), project: { ...doc().project, artFonts: [{ family: fam, asset: "art/fonts/x.ttf" }] } } }));
    await change(root.querySelector<HTMLSelectElement>('select[aria-label="Add file"]')!, "font");
    const name = getState().file!;
    expect(name).toMatch(/_font\.hzk$/);
    const base = AsciiFontLib.view(doc().assets.get("0_DWIN_ASC.HZK")!);
    const glyph = () => AsciiFontLib.view(doc().assets.get(name)!).glyph(24, 0x41);
    expect(equal(glyph().bits, base.glyph(24, 0x41).bits)).toBe(true); // copied from 0_DWIN_ASC

    const big = root.querySelector("canvas.glyph-big")!;
    const before = glyph().bits[0];
    await fire(big, new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1, buttons: 1, pointerId: 1 }));
    expect(glyph().bits[0]).toBe(before ? 0 : 1);

    const fontSel = [...root.querySelectorAll(".generator label.prop")].find((l) => l.textContent?.startsWith("Font"))!.querySelector("select")!;
    await change(fontSel, fam);
    const [from, to] = [...root.querySelectorAll(".generator label.prop")].find((l) => l.textContent?.startsWith("Heights"))!.querySelectorAll("select");
    await change(from!, "16");
    await change(to!, "16");
    await click(btn("Generate"));
    for (let i = 0; i < 50 && !btn("Generate"); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    const lib = AsciiFontLib.view(doc().assets.get(name)!);
    expect(equal(lib.glyph(16, 0x41).bits, base.glyph(16, 0x41).bits)).toBe(false); // regenerated
    expect(equal(lib.glyph(32, 0x41).bits, base.glyph(32, 0x41).bits)).toBe(true); // other heights kept
  });
});

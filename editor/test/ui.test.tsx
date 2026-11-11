// @vitest-environment happy-dom
// Smoke tests: render the real components and drive them like a user
// (no canvas in happy-dom; drawing is skipped).
import "fake-indexeddb/auto";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blankProject, decompile, describeTouch, describeVar, fromHex, hex, readHead, returnKey, writeHead } from "../src/core";
import { findControl } from "../src/core/project/ops";
import { pickDwinSet } from "../src/io/dwinset";
import * as idb from "../src/io/idb";
import { App } from "../src/ui/App";
import { flushSave, getState, openDoc, setState } from "../src/ui/store";
import { VENDOR_SET, list, read } from "./util";

let root: HTMLDivElement;

beforeEach(async () => {
  // a 480x272 screen at 1:1, so pointer coordinates are screen pixels
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 480, bottom: 272, width: 480, height: 272, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  setState({ layers: { touch: true, display: true, icons: true }, mode: "edit", panel: "inspect" });
  root = document.createElement("div");
  document.body.append(root);
  await act(() => render(<App />, root));
});

afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
});

const fire = (el: Element | null | undefined, ev: Event) => act(() => void el!.dispatchEvent(ev));
const click = (el: Element | null | undefined) => fire(el, new MouseEvent("click", { bubbles: true }));
const pointer = (el: Element | null | undefined, type: string, x: number, y: number) =>
  fire(el, new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts })));
const buttonByText = (text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const change = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("UI", () => {
  it("welcome -> project -> pages, selection, rename, autosave, layers", async () => {
    expect(root.textContent).toContain("New blank project");
    await click(buttonByText("New blank project"));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(root.querySelectorAll(".pages li").length).toBe(1);

    const { doc } = decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)])), "Vendor");
    await act(() => openDoc(doc));
    expect(root.querySelectorAll(".pages li").length).toBe(doc.project.pages.length);

    await click([...root.querySelectorAll(".page")].find((b) => b.textContent?.includes("home")));
    expect(getState().pageId).toBe(1);
    const rects = root.querySelectorAll("rect.ctl.touch");
    expect(rects.length).toBe(doc.project.pages.find((p) => p.id === 1)!.touch.length);
    await pointer(rects[0], "pointerdown", 1, 1);
    await pointer(root.querySelector("svg.overlay"), "pointerup", 1, 1);
    expect(getState().selection?.kind).toBe("touch");
    expect(getState().past.length).toBe(0); // a click is not an edit
    expect(root.querySelector(".inspector table.fields")).not.toBeNull();
    expect(root.querySelector(".inspector pre.hex")?.textContent).toMatch(/^00 {2}/);

    const title = root.querySelector<HTMLInputElement>(".toolbar .title")!;
    await change(title, "Renamed");
    await flushSave();
    expect(getState().save).toBe("saved");
    expect((await idb.listProjects()).find((p) => p.id === doc.project.id)?.name).toBe("Renamed");

    await click(root.querySelector<HTMLInputElement>(".layer.touch input"));
    expect(root.querySelectorAll("rect.ctl.touch").length).toBe(0);
  });

  it("double-clicking a Pic_Next button follows the jump", async () => {
    const doc = blankProject("Jumps");
    const k = returnKey(0, [10, 10, 100, 50], 0x1000, 1);
    doc.project.pages[0]!.touch.push({ uid: "j1", bytes: hex(writeHead(k, { ...readHead(k), picNext: 5 })) });
    doc.project.pages.push({ id: 5, name: "second", background: null, touch: [], display: [] });
    await act(() => openDoc(doc, [], false));
    const rect = root.querySelector("rect.ctl.touch")!;
    expect(rect.querySelector("title")!.textContent).toContain("→ page 5");
    await fire(rect, new MouseEvent("dblclick", { bubbles: true }));
    expect(getState().pageId).toBe(5);
    expect(root.querySelector(".inspector h3")!.textContent).toContain("Page 5");
  });

  it("add, drag, resize, nudge, edit a field, undo/redo, delete", async () => {
    await act(() => openDoc(blankProject("Edit"), [], false));
    const add = root.querySelector<HTMLSelectElement>("select.add")!;
    await change(add, "return-key");
    const uid = getState().selection!.uid;
    const bounds = () => describeTouch(fromHex(findControl(getState().doc!, uid)!.control.bytes)).bounds!;
    const start = bounds();
    expect(describeTouch(fromHex(findControl(getState().doc!, uid)!.control.bytes)).vp).toBe(0x1000);

    // drag by (+30, +20): one undo step
    const rect = () => root.querySelector("rect.ctl.touch.sel")!;
    const svg = root.querySelector("svg.overlay")!;
    await pointer(rect(), "pointerdown", start[0] + 5, start[1] + 5);
    await pointer(svg, "pointermove", start[0] + 20, start[1] + 15);
    await pointer(svg, "pointermove", start[0] + 35, start[1] + 25);
    await pointer(svg, "pointerup", start[0] + 35, start[1] + 25);
    expect(bounds()).toEqual([start[0] + 30, start[1] + 20, start[2] + 30, start[3] + 20]);
    expect(getState().past.length).toBe(2); // add + drag

    // resize with the south-east handle
    const b1 = bounds();
    await pointer(root.querySelector("rect.handle.h-se"), "pointerdown", b1[2] + 1, b1[3] + 1);
    await pointer(svg, "pointermove", b1[2] + 11, b1[3] + 6);
    await pointer(svg, "pointerup", b1[2] + 11, b1[3] + 6);
    expect(bounds()).toEqual([b1[0], b1[1], b1[2] + 10, b1[3] + 5]);

    // keyboard nudge
    await key("ArrowLeft", { shiftKey: true });
    expect(bounds()[0]).toBe(b1[0] - 10);

    // edit Key_Code in the inspector (hex input)
    const row = [...root.querySelectorAll(".inspector tr")].find((r) => r.textContent?.includes("Key_Code"))!;
    await change(row.querySelector<HTMLInputElement>("input")!, "0x00AB");
    expect(describeTouch(fromHex(findControl(getState().doc!, uid)!.control.bytes)).fields
      .find((f) => f.name === "Key_Code")!.value).toBe(0xab);

    // undo the field edit and the nudge, redo one
    await key("z", { ctrlKey: true });
    await key("z", { ctrlKey: true });
    expect(bounds()[0]).toBe(b1[0]);
    await key("z", { ctrlKey: true, shiftKey: true });
    expect(bounds()[0]).toBe(b1[0] - 10);

    // duplicate and delete via keyboard
    await key("d", { ctrlKey: true });
    expect(getState().doc!.project.pages[0]!.touch.length).toBe(2);
    await key("Delete");
    expect(getState().doc!.project.pages[0]!.touch.length).toBe(1);
  });

  it("pages: add, rename, renumber with references, VP panel", async () => {
    await act(() => openDoc(blankProject("Pages"), [], false));
    await click(buttonByText("+ Page"));
    expect(getState().pageId).toBe(1);
    const name = root.querySelector<HTMLInputElement>("dl.form input")!;
    await change(name, "menu");
    expect(getState().doc!.project.pages[1]).toMatchObject({ name: "menu", background: "001_menu.bmp" });

    // a jump from page 0 to page 1, then renumber 1 -> 7
    await click([...root.querySelectorAll(".page")][0]);
    await change(root.querySelector<HTMLSelectElement>("select.add")!, "button");
    const row = [...root.querySelectorAll(".inspector tr")].find((r) => r.textContent?.includes("Pic_Next"))!;
    await change(row.querySelector("select")!, "1");
    await click([...root.querySelectorAll(".page")][1]);
    window.confirm = () => true;
    await change(root.querySelectorAll<HTMLInputElement>("dl.form input")[1]!, "7");
    expect(getState().pageId).toBe(7);
    const jump = getState().doc!.project.pages[0]!.touch[0]!;
    expect(readHead(fromHex(jump.bytes)).picNext).toBe(7);

    await click(buttonByText("VPs"));
    expect(root.textContent).toContain("No overlapping VP ranges");
  });

  it("simulator: return key writes a VP, number display shows it", async () => {
    await act(() => openDoc(blankProject("Sim"), [], false));
    await change(root.querySelector<HTMLSelectElement>("select.add")!, "return-key");
    await change(root.querySelector<HTMLSelectElement>("select.add")!, "number");
    const numUid = getState().selection!.uid;
    const numVp = describeVar(fromHex(findControl(getState().doc!, numUid)!.control.bytes)).vp!;
    // point the number at the key's VP
    const vpRow = [...root.querySelectorAll(".inspector tr")].find((r) => r.querySelector("td:nth-child(2)")?.textContent === "VP")!;
    await change(vpRow.querySelector<HTMLInputElement>("input")!, "0x1000");
    expect(numVp).not.toBe(0x1000);

    await click(buttonByText("▶ Simulate"));
    expect(getState().mode).toBe("simulate");
    await click(root.querySelector("rect.ctl.sim"));
    expect(getState().sim.get(0x1000)).toBe(1);
    expect(root.textContent).toContain("write 0x1000 = 1");
    const page = getState().doc!.project.pages[0]!;
    expect(getState().sim.render(page)[0]).toMatchObject({ kind: "text", text: "1" });
    await click(buttonByText("■ Stop"));
    expect(getState().mode).toBe("edit");
  });
});

// @vitest-environment happy-dom
// Smoke test: render the real components with the vendored project and
// click through them (no canvas in happy-dom; drawing is skipped).
import "fake-indexeddb/auto";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { blankProject, decompile, hex, readHead, returnKey, writeHead } from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import * as idb from "../src/io/idb";
import { App } from "../src/ui/App";
import { flushSave, getState, openDoc, setState } from "../src/ui/store";
import { VENDOR_SET, list, read } from "./util";

const click = (el: Element | null | undefined) =>
  act(() => void el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const dblclick = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

describe("UI smoke test", () => {
  it("welcome -> project -> pages, selection, page jump, rename, autosave", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await act(() => render(<App />, root));
    expect(root.textContent).toContain("New blank project");

    // blank project from the welcome screen
    await click([...root.querySelectorAll("button")].find((b) => b.textContent === "New blank project"));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(root.querySelector(".toolbar")).not.toBeNull();
    expect(root.querySelectorAll(".pages li").length).toBe(1);

    // the vendored project
    const { doc } = decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)])), "Vendor");
    await act(() => openDoc(doc));
    expect(root.querySelectorAll(".pages li").length).toBe(doc.project.pages.length);

    // go to page 1 (home) and select its first touch area
    const home = [...root.querySelectorAll(".page")].find((b) => b.textContent?.includes("home"))!;
    await click(home);
    expect(getState().pageId).toBe(1);
    const rects = root.querySelectorAll("rect.ctl.touch");
    expect(rects.length).toBe(doc.project.pages.find((p) => p.id === 1)!.touch.length);
    await click(rects[0]);
    expect(getState().selection?.kind).toBe("touch");
    expect(root.querySelector(".inspector table.fields")).not.toBeNull();
    expect(root.querySelector(".inspector pre.hex")?.textContent).toMatch(/^00 {2}/);

    // rename -> autosave -> stored in IndexedDB
    const title = root.querySelector<HTMLInputElement>(".toolbar .title")!;
    await act(() => {
      title.value = "Renamed";
      title.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushSave();
    expect(getState().save).toBe("saved");
    const stored = await idb.listProjects();
    expect(stored.find((p) => p.id === doc.project.id)?.name).toBe("Renamed");

    // layer toggle hides touch rects
    const touchToggle = root.querySelector<HTMLInputElement>(".layer.touch input")!;
    await click(touchToggle);
    expect(root.querySelectorAll("rect.ctl.touch").length).toBe(0);
    render(null, root);
  });

  it("double-clicking a Pic_Next button follows the jump", async () => {
    const doc = blankProject("Jumps");
    const key = returnKey(0, [10, 10, 100, 50], 0x1000, 1);
    const jump = writeHead(key, { ...readHead(key), picNext: 5 });
    doc.project.pages[0]!.touch.push({ uid: "j1", bytes: hex(jump) });
    doc.project.pages.push({ id: 5, name: "second", background: null, touch: [], display: [] });
    const root = document.createElement("div");
    document.body.append(root);
    await act(() => render(<App />, root));
    await act(() => {
      setState({ layers: { touch: true, display: true, icons: true } });
      openDoc(doc, [], false);
    });
    const rect = root.querySelector("rect.ctl.touch")!;
    expect(rect.querySelector("title")!.textContent).toContain("→ page 5");
    await dblclick(rect);
    expect(getState().pageId).toBe(5);
    expect(root.querySelector(".inspector h3")!.textContent).toContain("Page 5");
    render(null, root);
  });
});

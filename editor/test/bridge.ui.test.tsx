// @vitest-environment happy-dom
// The editor against a fake bridge (fetch stub that follows the API of
// dgus_lcd/editor_bridge.py, whose own tests cover the server side).
import "fake-indexeddb/auto";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankProject, decompile, getPage, returnKey, addControl, addPage, readHead, writeHead } from "../src/core";
import { unzipSync } from "fflate";
import { loadDgusproj, saveDgusproj } from "../src/io/dgusproj";
import { pickDwinSet } from "../src/io/dwinset";
import { setToken } from "../src/io/bridge";
import { App } from "../src/ui/App";
import { getState, openDoc, setState } from "../src/ui/store";
import { VENDOR_SET, list, read } from "./util";

interface Call { method: string; path: string; body: unknown; token: string | null }

let calls: Call[];
let stored: Map<string, Uint8Array>;
let serviceRunning: boolean;
let polls: number;

function fakeBridge() {
  calls = [];
  stored = new Map();
  serviceRunning = false;
  polls = 0;
  const files = list(VENDOR_SET);
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = new URL(String(input), "http://pi.local/");
    const path = url.pathname.replace(/^\/api\//, "");
    const token = new Headers(init.headers).get("X-Bridge-Token");
    const body = init.body instanceof Uint8Array ? init.body : typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: path + url.search, body, token });
    const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
    const bytes = (b: Uint8Array) => new Response(b as Uint8Array<ArrayBuffer>, { status: 200 });
    if (path === "info") {
      return ok({ bridge: 1, serial: "/dev/ttyS1", baud: 250000, service_running: serviceRunning, force: false, busy: false,
        token_required: true, templates: [{ id: "dgus-reloaded", name: "DGUS-reloaded" }] });
    }
    if (token !== "tok") return ok({ error: "missing or wrong token" }, 401);
    if (path === "page" && method === "POST") return ok({ page: (body as { page: number }).page });
    if (path === "vp" && method === "POST") return ok({ vp: (body as { vp: number }).vp });
    if (path === "flash" && method === "POST") {
      const names = Object.keys(unzipSync(body as Uint8Array)).map((n) => n.replace(/^DWIN_SET\//, ""));
      return ok({ id: "j1", state: "running", error: null, reset: false, elapsed: 0,
        files: names.map((name) => ({ name, kind: "nand", id: 0, size: 10, status: "pending", done: 0, total: 0, where: null, error: null })) }, 202);
    }
    if (path === "jobs/j1") {
      polls++;
      const done = polls > 1;
      return ok({ id: "j1", state: done ? "done" : "running", error: null, reset: done, elapsed: 1.5,
        files: [{ name: "13_touch.bin", kind: "nand", id: 13, size: 10, status: done ? "done" : "uploading", done: 5, total: 10, where: "nand", error: null },
                { name: "T5UID1.CFG", kind: null, id: null, size: 128, status: "skipped", done: 0, total: 0, where: null, error: "SD card only" }] });
    }
    if (path === "projects" && method === "GET") {
      return ok([...stored].map(([id, b]) => { const d = loadDgusproj(b); return { id, name: d.project.name, modified: d.project.modified, pages: d.project.pages.length, size: b.length }; }));
    }
    const pm = /^projects\/(.+)$/.exec(path);
    if (pm && method === "PUT") { stored.set(pm[1]!, body as Uint8Array); return ok({ id: pm[1] }); }
    if (pm && method === "GET") return bytes(stored.get(pm[1]!)!);
    if (path === "templates/dgus-reloaded") return ok({ id: "dgus-reloaded", files: files.map((name) => ({ name, size: 1 })) });
    const tm = /^templates\/dgus-reloaded\/(.+)$/.exec(path);
    if (tm) return bytes(read(VENDOR_SET, decodeURIComponent(tm[1]!)));
    return ok({ error: "no such endpoint" }, 404);
  });
}

let root: HTMLDivElement;

beforeEach(async () => {
  fakeBridge();
  setToken("tok");
  window.alert = () => {};
  window.confirm = () => true;
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 480, bottom: 272, width: 480, height: 272, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  setState({ doc: null, mode: "edit", mirror: false, flashOpen: false, bridge: null, file: null });
  root = document.createElement("div");
  document.body.append(root);
  await act(() => render(<App />, root));
  await act(() => new Promise((r) => setTimeout(r, 30)));
});

afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  vi.unstubAllGlobals();
});

const fire = (el: Element | null | undefined, ev: Event) => act(() => void el!.dispatchEvent(ev));
const click = (el: Element | null | undefined) => fire(el, new MouseEvent("click", { bubbles: true }));
const btn = (text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text));
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("Pi bridge in the editor", () => {
  it("detects the bridge; template, save and open via the Pi", async () => {
    expect(getState().bridge?.baud).toBe(250000);
    expect(root.textContent).toContain("On the Pi");
    await click(btn("New from DGUS-reloaded"));
    for (let i = 0; i < 100 && !getState().doc; i++) await wait(20);
    const doc = getState().doc!;
    expect(doc.project.pages.length).toBe(decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc.project.pages.length);
    expect(calls.every((c) => c.path === "info" || c.token === "tok")).toBe(true);

    await click(btn("Save to Pi"));
    await wait(20);
    expect(stored.has(doc.project.id)).toBe(true);
    expect(loadDgusproj(stored.get(doc.project.id)!).project.name).toBe(doc.project.name);
  });

  it("flash dialog: uploads the compiled set and shows progress", async () => {
    await act(() => openDoc(blankProject("Flash me"), [], false));
    await wait(20);
    await click(btn("Flash…"));
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    await click([...root.querySelectorAll(".modal button")].find((b) => b.textContent === "Flash"));
    await wait(20);
    const flash = calls.find((c) => c.path.startsWith("flash?"))!;
    expect(flash.path).toContain("only_changed=1");
    expect(Object.keys(unzipSync(flash.body as Uint8Array)).sort()).toContain("DWIN_SET/13_touch.bin");
    for (let i = 0; i < 40 && !root.textContent?.includes("done after"); i++) await wait(100);
    expect(root.textContent).toContain("done after 1.5s, screen restarted");
    expect(root.textContent).toContain("SD card only");
    await click(btn("Close"));
    expect(getState().flashOpen).toBe(false);
  });

  it("show on screen, and simulator mirroring sends VP writes", async () => {
    const doc = blankProject("Mirror");
    addControl(doc, 0, "touch", returnKey(0, [0, 0, 479, 271], 0x1234, 7));
    await act(() => openDoc(doc, [], false));
    await wait(20);
    await click(btn("Show on screen"));
    await wait(10);
    expect(calls.find((c) => c.path === "page")?.body).toEqual({ page: 0 });

    await click(btn("▶ Simulate"));
    const mirrorBox = [...root.querySelectorAll("label")].find((l) => l.textContent?.includes("Mirror to the screen"))!.querySelector("input")!;
    await act(() => { mirrorBox.checked = true; mirrorBox.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(getState().mirror).toBe(true);
    await fire(root.querySelector("svg.overlay"), new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 }));
    await wait(20);
    expect(calls.filter((c) => c.path === "vp").map((c) => c.body)).toEqual([{ vp: 0x1234, words: [7] }]);
  });

  it("warns and disables screen actions while the service owns the port", async () => {
    serviceRunning = true;
    const { refreshBridge } = await import("../src/ui/bridgeUi");
    await act(() => refreshBridge());
    await act(() => openDoc(blankProject("Busy"), [], false));
    expect((btn("Show on screen") as HTMLButtonElement).disabled).toBe(true);
    await click(btn("Flash…"));
    expect(root.querySelector(".modal")!.textContent).toContain("systemctl stop dgus_lcd");
    expect(([...root.querySelectorAll(".modal button")].find((b) => b.textContent === "Flash") as HTMLButtonElement).disabled).toBe(true);
    void getPage;
    void saveDgusproj;
  });

  it("flash only this page (with or without the pictures it shows)", async () => {
    const doc = blankProject("One page");
    addPage(doc, { id: 1, name: "sel" });
    addPage(doc, { id: 2, name: "other" });
    const k = returnKey(0, [0, 0, 9, 9], 0x1000, 1);
    addControl(doc, 0, "touch", writeHead(k, { ...readHead(k), picOn: 1 }));
    await act(() => openDoc(doc, [], false));
    await act(() => setState({ pageId: 0 }));
    await wait(20);
    await click(btn("Flash this page…"));
    const radios = root.querySelectorAll<HTMLInputElement>('.modal input[type="radio"]');
    expect(radios[1]!.checked).toBe(true); // opened with "This page"
    expect(root.querySelector(".modal")!.textContent).toContain("pages 1 (pressed states");
    const flashBtn = () => [...root.querySelectorAll(".modal button")].find((b) => b.textContent === "Flash")!;
    await click(flashBtn());
    await wait(20);
    const zipped = (c: { body: unknown }) => Object.keys(unzipSync(c.body as Uint8Array)).filter((n) => n.startsWith("DWIN_SET/")).sort();
    expect(zipped(calls.filter((c) => c.path.startsWith("flash?")).at(-1)!)).toEqual(
      ["DWIN_SET/000_main.bmp", "DWIN_SET/001_sel.bmp", "DWIN_SET/13_touch.bin", "DWIN_SET/14_variable.bin"]);
    for (let i = 0; i < 40 && !root.textContent?.includes("done after"); i++) await wait(100);
    await click(btn("Close"));

    // again without the referenced pictures
    await click(btn("Flash this page…"));
    const refs = [...root.querySelectorAll(".modal label")].find((l) => l.textContent?.includes("pictures it shows"))!.querySelector("input")!;
    await act(() => { refs.checked = false; refs.dispatchEvent(new Event("change", { bubbles: true })); });
    polls = 0;
    await click(flashBtn());
    await wait(20);
    expect(zipped(calls.filter((c) => c.path.startsWith("flash?")).at(-1)!)).toEqual(
      ["DWIN_SET/000_main.bmp", "DWIN_SET/13_touch.bin", "DWIN_SET/14_variable.bin"]);
    for (let i = 0; i < 40 && !root.textContent?.includes("done after"); i++) await wait(100);
    await click(btn("Close"));

    // the toolbar's Flash… still means the whole project
    await click(btn("Flash…"));
    expect(root.querySelectorAll<HTMLInputElement>('.modal input[type="radio"]')[0]!.checked).toBe(true);
  });
});

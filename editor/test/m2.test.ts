import { describe, expect, it } from "vitest";
import {
  Simulator, TEMPLATES, TouchFile, VariableFile, addControl, addPage, allocVp, blankProject, canMove,
  compile, countPageRefs, decodeCfg, decompile, deleteControl, deletePage, describeTouch, describeVar,
  duplicateControl, duplicatePage, encodeCfg, fieldSpecs, findControl, fromHex, getPage, hex, moveBy,
  readHead, renamePage, renumberPage, reorderControl, resizable, returnKey, setBox, textVar, updateControl,
  vpClashes, vpUses, writeField, writeHead,
} from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { VENDOR_SET, list, read } from "./util";

const vendor = () => decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;

describe("templates", () => {
  const doc = vendor();
  const all = doc.project.pages.flatMap((p) => p.display.map((c) => fromHex(c.bytes)));

  for (const t of TEMPLATES) {
    it(`${t.id}: valid entry that decodes as expected`, () => {
      const e = t.make(3, 40, 50, 0x1234);
      if (t.kind === "touch") {
        expect(TouchFile.parse(new TouchFile([e]).build()).entries.length).toBe(1);
        const i = describeTouch(e);
        expect(i.bounds![0]).toBe(40);
        expect(e[1]).toBe(3);
        if (t.words) expect(i.vp).toBe(0x1234);
      } else {
        expect(e.length).toBe(32);
        const i = describeVar(e);
        expect(i.vp).toBe(0x1234);
        expect(i.bounds![0]).toBe(40);
        // header words match DGUS-reloaded's entries of the same type
        const real = all.find((r) => r[1] === e[1]);
        if (real) expect(hex(e.subarray(0, 6))).toBe(hex(real.subarray(0, 6)));
      }
    });
  }
});

describe("geometry", () => {
  it("moves every position field and clamps to the screen", () => {
    const e = textVar(0x1000, 10, 20, [10, 20, 109, 43], 20);
    const m = describeVar(moveBy("display", e, 5, -3));
    expect(m.bounds).toEqual([15, 17, 114, 40]);
    expect(m.fields.find((f) => f.name === "X")!.value).toBe(15);
    const far = describeVar(moveBy("display", e, 1000, -1000));
    expect(far.bounds).toEqual([380, 0, 479, 23]);
  });

  it("resizes boxes; anchors follow the top-left corner", () => {
    const e = textVar(0x1000, 10, 20, [10, 20, 109, 43], 20);
    expect(resizable("display", e)).toBe(true);
    const r = describeVar(setBox("display", e, [30, 40, 5, 10]));
    expect(r.bounds).toEqual([5, 10, 30, 40]);
    expect(r.fields.find((f) => f.name === "X")!.value).toBe(5);
    const key = returnKey(1, [0, 0, 10, 10], 1, 1);
    expect(describeTouch(setBox("touch", key, [1, 2, 300, 400])).bounds).toEqual([1, 2, 300, 271]);
    const num = TEMPLATES.find((t) => t.id === "number")!.make(0, 1, 1, 1);
    expect(resizable("display", num)).toBe(false);
    expect(canMove("display", num)).toBe(true);
  });

  it("number input's cursor moves with its area, the keypad doesn't", () => {
    const e = TEMPLATES.find((t) => t.id === "data-input")!.make(0, 10, 10, 0x1000);
    const before = describeTouch(e).fields;
    const after = describeTouch(moveBy("touch", e, 20, 0)).fields;
    const v = (fs: typeof before, n: string) => fs.find((f) => f.name === n)!.value;
    expect(v(after, "Cursor X") - v(before, "Cursor X")).toBe(20);
    expect(v(after, "KB X")).toBe(v(before, "KB X"));
  });

  it("writeField clamps to the field's range", () => {
    const e = returnKey(1, [0, 0, 10, 10], 1, 1);
    const s = fieldSpecs("touch", e).find((f) => f.name === "Key_Code")!;
    expect(describeTouch(writeField(e, s, 0x12345)).fields.find((f) => f.name === "Key_Code")!.value).toBe(0xffff);
  });
});

describe("page operations", () => {
  it("adds, renames, duplicates and deletes pages", () => {
    const doc = blankProject();
    const p = addPage(doc, { name: "settings", rgb: [10, 20, 30] });
    expect(p).toMatchObject({ id: 1, background: "001_settings.bmp" });
    renamePage(doc, 1, "menu");
    expect(getPage(doc, 1).background).toBe("001_menu.bmp");
    expect(doc.assets.has("001_settings.bmp")).toBe(false);
    addControl(doc, 1, "touch", returnKey(0, [0, 0, 9, 9], 0x1000, 1));
    const copy = duplicatePage(doc, 1);
    expect(copy.id).toBe(2);
    expect(readHead(fromHex(copy.touch[0]!.bytes)).page).toBe(2);
    deletePage(doc, 2);
    expect(doc.project.pages.map((x) => x.id)).toEqual([0, 1]);
    const out = compile(doc);
    expect(TouchFile.parse(out.get("13_touch.bin")!).pages()).toEqual([1]);
  });

  it("renumbering updates the touch page, jumps, keypads and the boot page", () => {
    const doc = blankProject();
    addPage(doc, { id: 5, name: "target" });
    const jump = writeHead(returnKey(0, [0, 0, 9, 9], 1, 1), { ...readHead(returnKey(0, [0, 0, 9, 9], 1, 1)), picNext: 5 });
    addControl(doc, 0, "touch", jump);
    addControl(doc, 5, "touch", returnKey(5, [0, 0, 9, 9], 1, 2));
    const cfgName = "T5UID1.CFG";
    const c = decodeCfg(doc.assets.get(cfgName)!);
    c.bootPage = 5;
    doc.assets.set(cfgName, encodeCfg(c, doc.assets.get(cfgName)!));
    expect(countPageRefs(doc, 5)).toBe(1);
    expect(renumberPage(doc, 5, 9)).toBe(2);
    expect(readHead(fromHex(getPage(doc, 0).touch[0]!.bytes)).picNext).toBe(9);
    expect(readHead(fromHex(getPage(doc, 9).touch[0]!.bytes)).page).toBe(9);
    expect(getPage(doc, 9).background).toBe("009_target.bmp");
    expect(decodeCfg(doc.assets.get(cfgName)!).bootPage).toBe(9);
    expect(() => renumberPage(doc, 9, 0)).toThrow(/exists/);
    expect(() => renumberPage(doc, 9, 300)).toThrow(/<= 255/);
  });

  it("renumbering a vendored page keeps the project compiling", () => {
    const doc = vendor();
    renumberPage(doc, 202, 230);
    const v = VariableFile.parse(compile(doc).get("14_variable.bin")!);
    expect(v.pages.has(230) || getPage(doc, 230).display.length === 0).toBe(true);
    const keypadRefs = doc.project.pages.flatMap((p) => p.touch.map((c) => describeTouch(fromHex(c.bytes))))
      .filter((i) => i.type === 0x00).map((i) => i.fields.find((f) => f.name === "PIC_KB")!.value);
    expect(keypadRefs.length).toBeGreaterThan(0);
    expect(keypadRefs.every((p) => p === 230)).toBe(true);
  });
});

describe("control operations", () => {
  it("add / update / duplicate / reorder / delete", () => {
    const doc = blankProject();
    const a = addControl(doc, 0, "touch", returnKey(7, [0, 0, 9, 9], 0x1000, 1));
    expect(readHead(fromHex(findControl(doc, a)!.control.bytes)).page).toBe(0);
    const b = duplicateControl(doc, a);
    expect(describeTouch(fromHex(findControl(doc, b)!.control.bytes)).bounds).toEqual([8, 8, 17, 17]);
    reorderControl(doc, b, -1);
    expect(getPage(doc, 0).touch.map((c) => c.uid)).toEqual([b, a]);
    expect(() => updateControl(doc, a, new Uint8Array(16))).toThrow(/32 bytes/);
    deleteControl(doc, a);
    expect(getPage(doc, 0).touch.map((c) => c.uid)).toEqual([b]);
  });
});

describe("VPs", () => {
  it("lists uses and finds partial overlaps only", () => {
    const doc = blankProject();
    addControl(doc, 0, "display", textVar(0x1000, 0, 0, [0, 0, 99, 19], 20)); // 10 words
    addControl(doc, 0, "touch", returnKey(0, [0, 0, 9, 9], 0x1000, 1)); // same start: fine
    expect(vpClashes(vpUses(doc))).toEqual([]);
    addControl(doc, 0, "touch", returnKey(0, [0, 0, 9, 9], 0x1004, 1)); // inside the text
    const clashes = vpClashes(vpUses(doc));
    expect(clashes.length).toBe(1);
    expect([clashes[0]!.a.vp, clashes[0]!.b.vp]).toEqual([0x1000, 0x1004]);
    expect(allocVp(doc, 2)).toBe(0x100a);
  });

  it("the vendored project has VP uses and no clashes", () => {
    const uses = vpUses(vendor());
    expect(uses.length).toBeGreaterThan(100);
    const clashes = vpClashes(uses);
    expect(clashes.map((c) => `${c.a.typeName}@${c.a.vp.toString(16)} vs ${c.b.typeName}@${c.b.vp.toString(16)}`)).toEqual([]);
  });
});

describe("simulator", () => {
  it("return keys, +/- with limits, jumps", () => {
    const sim = new Simulator(0);
    sim.press(returnKey(0, [0, 0, 9, 9], 0x1000, 0x42));
    expect(sim.get(0x1000)).toBe(0x42);
    sim.press(returnKey(0, [0, 0, 9, 9], 0x1001, 1, { mode: 0x13 }));
    expect(sim.get(0x1001)).toBe(8);
    const inc = TEMPLATES.find((t) => t.id === "increment")!.make(0, 0, 0, 0x2000);
    for (let k = 0; k < 150; k++) sim.press(inc);
    expect(sim.get(0x2000)).toBe(100);
    const k = returnKey(0, [0, 0, 9, 9], 1, 1);
    const r = sim.press(writeHead(k, { ...readHead(k), picNext: 4 }));
    expect(r.events.some((e) => e.type === "jump" && e.page === 4)).toBe(true);
    expect(sim.page).toBe(4);
  });

  it("number input scales by decimals and checks limits", () => {
    const sim = new Simulator(0);
    const e = TEMPLATES.find((t) => t.id === "data-input")!.make(0, 0, 0, 0x3000);
    const { input } = sim.press(e);
    expect(input).toMatchObject({ kind: "number", vp: 0x3000, nDot: 2, words: 2 });
    expect(sim.enter(input!, "12.5")).toBeNull();
    expect(sim.read(0x3000, 2, true)).toBe(1250);
    expect(sim.enter(input!, "-0.01")).toBeNull();
    expect(sim.read(0x3000, 2, true)).toBe(-1);
    expect(sim.enter(input!, "99999999")).toMatch(/maximum/);
  });

  it("slider maps the touch position to a value", () => {
    const sim = new Simulator(0);
    const e = TEMPLATES.find((t) => t.id === "slider")!.make(0, 100, 0, 0x4000);
    sim.press(e, 100 + 199 / 2, 10);
    expect(sim.get(0x4000)).toBe(50);
  });

  it("renders numbers, text and icons", () => {
    const sim = new Simulator(0);
    const doc = blankProject();
    const num = TEMPLATES.find((t) => t.id === "number")!.make(0, 10, 10, 0x1000);
    const n2 = writeField(num, fieldSpecs("display", num).find((f) => f.name === "Dec_Num")!, 1);
    addControl(doc, 0, "display", n2);
    addControl(doc, 0, "display", textVar(0x2000, 0, 50, [0, 50, 99, 69], 10));
    addControl(doc, 0, "display", TEMPLATES.find((t) => t.id === "bit-icon")!.make(0, 5, 5, 0x3000));
    sim.write(0x1000, 1, -123, "test");
    sim.enter({ kind: "text", vp: 0x2000, nDot: 0, words: 0, maxBytes: 10, min: null, max: null, keypadPage: null }, "Hi!");
    sim.set(0x3000, 1);
    const d = sim.render(getPage(doc, 0));
    expect(d[0]).toMatchObject({ kind: "text", text: "-12.3" });
    expect(d[1]).toMatchObject({ kind: "text", text: "Hi!" });
    expect(d[2]).toMatchObject({ kind: "icon", icon: { id: 1 } });
  });
});

import { describe, expect, it } from "vitest";
import {
  Bitmap, TouchFile, VariableFile, blankProject, compile, decodeCfg, decompile, describeTouch, describeVar,
  equal, fromHex,
} from "../src/core";
import { loadDgusproj, saveDgusproj } from "../src/io/dgusproj";
import { pickDwinSet, unzipDwinSet, zipDwinSet } from "../src/io/dwinset";
import { MACROS_SET, VENDOR_SET, fixtures, list, read } from "./util";

function loadSet(dir: string): Map<string, Uint8Array> {
  return new Map(list(dir).map((n) => [n, read(dir, n)]));
}

function expectSame(a: Map<string, Uint8Array>, b: Map<string, Uint8Array>) {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  const differ = [...a].filter(([k, v]) => !equal(v, b.get(k)!)).map(([k]) => k);
  expect(differ).toEqual([]);
}

describe("project decompile / compile", () => {
  for (const dir of [VENDOR_SET, MACROS_SET]) {
    const files = pickDwinSet(loadSet(dir));

    it(`${dir}: import -> export is byte-identical`, () => {
      const { doc, warnings } = decompile(files);
      expect(warnings).toEqual([]);
      expectSame(compile(doc), files);
    });

    it(`${dir}: survives .dgusproj and DWIN_SET zip round trips`, () => {
      const { doc } = decompile(files);
      const again = loadDgusproj(saveDgusproj(doc));
      expect(again.project).toEqual(doc.project);
      expectSame(compile(again), files);
      expectSame(unzipDwinSet(zipDwinSet(compile(again), "readme")), files);
    });
  }

  it("builds pages from pictures and controls", () => {
    const vendor = decompile(pickDwinSet(loadSet(VENDOR_SET))).doc.project;
    const home = vendor.pages.find((x) => x.id === 1)!;
    expect(home).toMatchObject({ name: "home", background: "001_home.bmp" });
    expect(home.touch.length).toBeGreaterThan(0);
    const { doc } = decompile(pickDwinSet(loadSet(MACROS_SET)));
    const p = doc.project;
    const ids = p.pages.map((x) => x.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    const macros = p.pages.find((x) => x.id === 21)!;
    expect(macros.background).toBe("021_macros.bmp");
    // every control decodes
    const vars = VariableFile.parse(read(MACROS_SET, "14_variable.bin"));
    const textVps = Object.values<any[]>(fixtures.sets.macros.textVars).flat().map((t) => t.vp).sort();
    const found = p.pages.flatMap((pg) => pg.display.map((c) => describeVar(fromHex(c.bytes))))
      .filter((i) => i.type === 0x11).map((i) => i.vp).sort();
    expect(found).toEqual(textVps);
    expect([...vars.pages.values()].flat().length).toBe(p.pages.reduce((n, pg) => n + pg.display.length, 0));
  });

  it("describes every vendored control with sensible bounds", () => {
    const { doc } = decompile(pickDwinSet(loadSet(VENDOR_SET)));
    for (const pg of doc.project.pages) {
      for (const c of pg.touch) {
        const i = describeTouch(fromHex(c.bytes));
        const [xs, ys, xe, ye] = i.bounds!;
        expect(xs <= xe && ys <= ye && xe < 480 && ye < 272).toBe(true);
      }
      for (const c of pg.display) {
        const i = describeVar(fromHex(c.bytes));
        expect(i.typeName).not.toMatch(/^Type/);
        expect(i.bounds).not.toBeNull();
      }
    }
  });

  it("return keys decode the same VPs as screen_files.py", () => {
    const { doc } = decompile(pickDwinSet(loadSet(VENDOR_SET)));
    const vps = doc.project.pages.flatMap((pg) => pg.touch.map((c) => describeTouch(fromHex(c.bytes))))
      .filter((i) => i.type === 0x05).map((i) => i.vp);
    expect(vps).toEqual(fixtures.sets.vendor.returnKeys.map((k: any) => k.vp));
  });

  it("follows page jumps", () => {
    const { doc } = decompile(pickDwinSet(loadSet(VENDOR_SET)));
    const jumps = doc.project.pages.flatMap((pg) => pg.touch.map((c) => describeTouch(fromHex(c.bytes)).jumpTo))
      .filter((j) => j !== null);
    const ids = new Set(doc.project.pages.map((p) => p.id));
    expect(jumps.every((j) => ids.has(j!))).toBe(true);
  });

  it("a blank project compiles to valid files", () => {
    const doc = blankProject("Test");
    const out = compile(doc);
    expect([...out.keys()].sort()).toEqual(["000_main.bmp", "13_touch.bin", "14_variable.bin", "22_config.bin", "T5UID1.CFG"]);
    expect(TouchFile.parse(out.get("13_touch.bin")!).entries).toEqual([]);
    expect(VariableFile.parse(out.get("14_variable.bin")!).pages.size).toBe(0);
    expect(Bitmap.load(out.get("000_main.bmp")!).get(10, 10)).toEqual([255, 255, 255]);
    expect(decodeCfg(out.get("T5UID1.CFG")!).rotation).toBe(0);
    const { doc: back } = decompile(out);
    expectSame(compile(back), out);
  });

  it("picks the DWIN_SET folder out of a bigger tree", () => {
    const m = pickDwinSet([
      ["proj/DWIN_SET/13_touch.bin", new Uint8Array([0xff, 0xff])],
      ["proj/TFT/001.bmp.tft", new Uint8Array(1)],
      ["proj/notes.txt", new Uint8Array(1)],
      ["proj/DWIN_SET/.DS_Store", new Uint8Array(1)],
    ]);
    expect([...m.keys()]).toEqual(["13_touch.bin"]);
  });

  it("rejects bad .dgusproj files", () => {
    expect(() => loadDgusproj(new Uint8Array([1, 2, 3]))).toThrow(/not a .dgusproj/);
  });
});

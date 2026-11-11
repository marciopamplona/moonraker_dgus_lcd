import { describe, expect, it } from "vitest";
import {
  Bitmap, IconLibrary, addControl, addFile, blankProject, compile, countLibRefs, decompile, deleteFile, deleteIcon,
  describeVar, fileSizes, freeFontId, fromHex, getCfg, iconFromRGBA, iconIdFromName, iconUsage, moveIcon, nandProblems,
  nandUses, newAsciiFont, newIconLibrary, renameFile, replaceFile, setCfg, setIcons, setSramRuns, SramInit, textWords,
  TEMPLATES, getPage, AsciiFontLib,
} from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { VENDOR_SET, list, read } from "./util";

const vendor = () => decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;

describe("NAND map", () => {
  it("vendored set: sizes match the compiled files, nothing overlaps", () => {
    const doc = vendor();
    const out = compile(doc);
    const sizes = fileSizes(doc);
    for (const [k, v] of out) expect(sizes.get(k), k).toBe(v.length);
    const uses = nandUses(doc);
    expect(uses.find((u) => u.name === "0_DWIN_ASC.HZK")).toMatchObject({ firstId: 0, lastId: 11 });
    expect(uses.find((u) => u.name === "30_progress_left.ico")).toMatchObject({ firstId: 30, lastId: 35 });
    expect(nandProblems(uses)).toEqual([]);
  });

  it("finds overlaps and free space", () => {
    const doc = vendor();
    newIconLibrary(doc, 33, "clash"); // inside 30_progress_left (30-35)
    const p = nandProblems(nandUses(doc));
    expect(p.map((x) => x.names.sort().join("+"))).toEqual(["30_progress_left.ico+33_clash.ico"]);
    const free = freeFontId(nandUses(vendor()), 3 * 1024 * 1024);
    // 12 blocks free after the used ids
    const uses = nandUses(vendor());
    expect(uses.some((u) => u.firstId <= free + 11 && u.lastId >= free)).toBe(false);
  });
});

describe("file operations", () => {
  it("add / replace / delete with validation", () => {
    const doc = blankProject();
    expect(() => addFile(doc, "001_x.bmp", new Uint8Array(4))).toThrow(/pages/);
    expect(() => addFile(doc, "13_touch.bin", new Uint8Array(4))).toThrow(/built from the pages/);
    expect(() => addFile(doc, "notes.txt", new Uint8Array(4))).toThrow(/not a DWIN_SET/);
    expect(() => addFile(doc, "40_bad.ico", new Uint8Array(4))).toThrow();
    expect(() => addFile(doc, "05_beep.wav", new Uint8Array(8))).toThrow(/WAV/);
    const wav = new Uint8Array(64);
    wav.set([0x52, 0x49, 0x46, 0x46]);
    addFile(doc, "05_beep.wav", wav);
    expect(() => addFile(doc, "05_BEEP.wav", wav)).toThrow(/exists/);
    replaceFile(doc, "05_beep.wav", wav.slice());
    deleteFile(doc, "05_beep.wav");
    expect(doc.assets.has("05_beep.wav")).toBe(false);
    expect([...compile(doc).keys()]).not.toContain("05_beep.wav");
  });

  it("renaming an icon library updates the controls that use it", () => {
    const doc = vendor();
    const before = countLibRefs(doc, 24);
    expect(before).toBeGreaterThan(0);
    const r = renameFile(doc, "24_icons.ico", 60, "icons");
    expect(r).toEqual({ name: "60_icons.ico", refs: before });
    expect(countLibRefs(doc, 24)).toBe(0);
    expect(countLibRefs(doc, 60)).toBe(before);
    expect(doc.assets.has("60_icons.ico")).toBe(true);
    expect(() => renameFile(doc, "60_icons.ico", 27, "buttons")).toThrow(/exists/);
  });
});

describe("icon libraries", () => {
  it("new library, set / move / delete icons, file stays parseable", () => {
    const doc = blankProject();
    newIconLibrary(doc, 40, "mine");
    const red = new Uint8Array(4 * 4 * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
    setIcons(doc, "40_mine.ico", [[3, iconFromRGBA(4, 4, red)], [7, iconFromRGBA(4, 4, red)]]);
    moveIcon(doc, "40_mine.ico", 3, 5);
    deleteIcon(doc, "40_mine.ico", 7);
    const lib = IconLibrary.parse(doc.assets.get("40_mine.ico")!);
    expect([...lib.icons.keys()]).toEqual([5]);
    expect(lib.icons.get(5)!.pixels[0]).toBe(0xf800);
    expect(() => moveIcon(doc, "40_mine.ico", 9, 1)).toThrow(/no icon/);
  });

  it("transparency: clear pixels -> 0x0000, opaque black -> 0x0020", () => {
    const px = [0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255];
    const ic = iconFromRGBA(3, 1, px);
    expect([...ic.pixels]).toEqual([0x0000, 0x0020, 0xffff]);
    expect([...iconFromRGBA(3, 1, px, { transparency: false }).pixels]).toEqual([0, 0, 0xffff]);
    expect(() => iconFromRGBA(256, 1, [])).toThrow(/1-255/);
  });

  it("ids from file names; usage counts from display variables", () => {
    expect(iconIdFromName("12.png")).toBe(12);
    expect(iconIdFromName("folder/7_ok.bmp")).toBe(7);
    expect(iconIdFromName("logo.png")).toBeNull();
    const doc = vendor();
    const usage = iconUsage(doc, 24);
    expect(usage.size).toBeGreaterThan(0);
    const icons = IconLibrary.parse(doc.assets.get("24_icons.ico")!).icons;
    for (const id of usage.keys()) expect(icons.has(id), `icon ${id} used but missing`).toBe(true);
  });
});

describe("fonts, CFG, 22*.BIN", () => {
  it("new ASCII font copies a base library", () => {
    const doc = vendor();
    const base = doc.assets.get("0_DWIN_ASC.HZK")!;
    newAsciiFont(doc, 60, "my font", base);
    const lib = AsciiFontLib.parse(doc.assets.get("60_my_font.hzk")!);
    expect(lib.glyph(16, 0x41).bits.some((b) => b)).toBe(true);
  });

  it("CFG: edits create the file if missing", () => {
    const doc = blankProject();
    doc.project.files = doc.project.files.filter((f) => f.kind !== "config");
    doc.assets.delete("T5UID1.CFG");
    expect(getCfg(doc)).toBeNull();
    const c = getCfg(blankProject())!;
    setCfg(doc, { ...c, rotation: 180, bootPageEn: true, bootPage: 3 });
    expect(getCfg(doc)).toMatchObject({ rotation: 180, bootPageEn: true, bootPage: 3 });
  });

  it("22*.BIN: runs and text become words; out of range fails", () => {
    const doc = blankProject();
    setSramRuns(doc, [{ vp: 0x1000, words: [1, 2] }, { vp: 0x2000, words: textWords("Hi!") }]);
    const s = SramInit.parse(doc.assets.get("22_config.bin")!);
    expect(s.runs()).toEqual([{ vp: 0x1000, words: [1, 2] }, { vp: 0x2000, words: [0x4869, 0x2100] }]);
    expect(() => setSramRuns(doc, [{ vp: 0x10002, words: [1] }])).toThrow(/outside/); // 0x20004 bytes = VPs 0..0x10001
    // a text display reading 0x2000 shows it at power on
    addTextAt(doc);
  });
});

function addTextAt(doc: ReturnType<typeof blankProject>) {
  const e = TEMPLATES.find((t) => t.id === "text")!.make(0, 0, 0, 0x2000);
  addControl(doc, 0, "display", e);
  expect(describeVar(fromHex(getPage(doc, 0).display[0]!.bytes)).vp).toBe(0x2000);
  void Bitmap;
}

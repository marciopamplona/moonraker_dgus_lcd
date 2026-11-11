import { describe, expect, it } from "vitest";
import { ASCII_LIB_SIZE, AsciiFontLib, equal } from "../src/core";
import { VENDOR_SET, read } from "./util";

const render = (g: { w: number; h: number; bits: Uint8Array }) =>
  Array.from({ length: g.h }, (_, y) =>
    Array.from(g.bits.subarray(y * g.w, (y + 1) * g.w), (b) => (b ? "#" : ".")).join(""));

describe("0_DWIN_ASC.HZK", () => {
  const data = read(VENDOR_SET, "0_DWIN_ASC.HZK");
  const lib = AsciiFontLib.parse(data);

  it("layout covers the whole file", () => expect(ASCII_LIB_SIZE).toBe(data.length));
  it("round trip is byte-identical", () => expect(equal(lib.build(), data)).toBe(true));

  it("decodes recognisable glyphs at several sizes", () => {
    expect(render(lib.glyph(16, 0x41)).slice(4, 12)).toEqual([
      "...##...", "..####..", "..####..", "..####..",
      ".##..##.", ".######.", ".##..##.", "##....##",
    ]);
    // every size has ink for 'A' and none for space
    for (const h of [8, 24, 48, 128]) {
      expect(lib.glyph(h, 0x41).bits.some((b) => b)).toBe(true);
      expect(lib.glyph(h, 0x20).bits.some((b) => b)).toBe(false);
    }
  });

  it("setGlyph writes only that glyph", () => {
    const copy = new AsciiFontLib(data);
    const g = copy.glyph(24, 0x30);
    g.bits.fill(1);
    copy.setGlyph(24, 0x30, g);
    expect(copy.glyph(24, 0x30).bits.every((b) => b === 1)).toBe(true);
    expect(equal(copy.glyph(24, 0x31).bits, lib.glyph(24, 0x31).bits)).toBe(true);
    expect(() => copy.glyph(9, 0)).toThrow();
  });
});

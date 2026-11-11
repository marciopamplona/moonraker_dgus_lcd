import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { AsciiFontLib, DEFAULT_RASTER, equal, generateAscii, rasterGlyph, type CanvasFactory } from "../src/core";
import { registerTestFont } from "./artenv";

const make = ((w: number, h: number) => createCanvas(w, h)) as unknown as CanvasFactory;
const ink = (bits: Uint8Array) => bits.reduce((a, b) => a + b, 0);

describe("TTF -> ASCII font library", () => {
  const family = registerTestFont();
  const o = { ...DEFAULT_RASTER, family };

  it("glyphs fill the cell sensibly and space is empty", () => {
    const a = rasterGlyph(make, 32, 0x41, o);
    expect([a.w, a.h]).toEqual([16, 32]);
    expect(ink(a.bits)).toBeGreaterThan(40);
    expect(ink(rasterGlyph(make, 32, 0x20, o).bits)).toBe(0);
    // 'A' sits above 'g''s descender: compare lowest rows with ink
    const lowest = (g: typeof a) => Math.max(...[...g.bits].map((b, i) => (b ? Math.floor(i / g.w) : -1)));
    expect(lowest(rasterGlyph(make, 32, 0x67, o))).toBeGreaterThan(lowest(a));
    // nothing touches the cell's left/right edge for a narrow glyph
    const i = rasterGlyph(make, 32, 0x69, o);
    for (let y = 0; y < 32; y++) expect(i.bits[y * 16]! + i.bits[y * 16 + 15]!).toBe(0);
  });

  it("bold has more ink; offsets move the glyph", () => {
    expect(ink(rasterGlyph(make, 32, 0x48, { ...o, bold: true }).bits)).toBeGreaterThan(ink(rasterGlyph(make, 32, 0x48, o).bits));
    const left = rasterGlyph(make, 32, 0x49, { ...o, dx: -2 }), right = rasterGlyph(make, 32, 0x49, { ...o, dx: 2 });
    const firstCol = (g: typeof left) => Math.min(...[...g.bits].map((b, k) => (b ? k % g.w : 99)));
    expect(firstCol(right)).toBeGreaterThan(firstCol(left));
  });

  it("generates only the chosen heights and codes, keeping the rest", () => {
    const base = new AsciiFontLib();
    const before = base.glyph(24, 0x41);
    let calls = 0;
    generateAscii(base, make, { ...o, heights: [16, 24], codes: [0x41, 0x42], progress: () => void calls++ });
    expect(calls).toBe(2);
    expect(equal(base.glyph(24, 0x41).bits, before.bits)).toBe(false);
    expect(ink(base.glyph(16, 0x42).bits)).toBeGreaterThan(0);
    expect(ink(base.glyph(16, 0x43).bits)).toBe(0); // not generated
    expect(ink(base.glyph(32, 0x41).bits)).toBe(0); // other height untouched
    expect(() => generateAscii(base, make, { ...o, heights: [16], progress: () => false })).toThrow(/cancelled/);
  });
});

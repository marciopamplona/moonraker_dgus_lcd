import { describe, expect, it } from "vitest";
import { Bitmap, equal } from "../src/core";
import { VENDOR_SET, fixtures, read, sha256 } from "./util";

describe("BMP", () => {
  const names = Object.keys(fixtures.bitmaps);
  it("has fixtures", () => expect(names.length).toBeGreaterThan(30));

  for (const name of names) {
    it(`${name}: same pixels and save() bytes as screen_files.py`, () => {
      const f = fixtures.bitmaps[name];
      const bm = Bitmap.load(read(VENDOR_SET, name));
      expect([bm.w, bm.h]).toEqual([f.w, f.h]);
      expect(sha256(bm.px)).toBe(f.pixels);
      const saved = bm.save();
      expect(sha256(saved)).toBe(f.save);
      expect(equal(Bitmap.load(saved).px, bm.px)).toBe(true);
    });
  }

  it("odd widths are padded and RGBA converts both ways", () => {
    const bm = new Bitmap(3, 2);
    bm.set(0, 0, [1, 2, 3]);
    bm.set(2, 1, [250, 128, 7]);
    const back = Bitmap.load(bm.save());
    expect(back.get(0, 0)).toEqual([1, 2, 3]);
    expect(back.get(2, 1)).toEqual([250, 128, 7]);
    expect(equal(Bitmap.fromRGBA(3, 2, bm.toRGBA()).px, bm.px)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { TouchFile, dataInput, equal, hex, parseReturnKey, readHead, returnKey, writeHead } from "../src/core";
import { fixtures, read } from "./util";

describe("13*.BIN touch file", () => {
  for (const [key, set] of Object.entries<any>(fixtures.sets)) {
    it(`${key}: parse -> build is byte-identical`, () => {
      const data = read(set.dir, "13_touch.bin");
      const t = TouchFile.parse(data);
      expect(t.entries.length).toBe(set.touchCount);
      expect(equal(t.build(), data)).toBe(true);
    });

    it(`${key}: decodes like screen_files.py`, () => {
      const t = TouchFile.parse(read(set.dir, "13_touch.bin"));
      expect(t.pages()).toEqual(set.touchPages);
      const keys = t.entries.map(parseReturnKey).filter((k) => k !== null);
      expect(keys).toEqual(set.returnKeys);
    });
  }

  it("builders match screen_files.py", () => {
    const b = fixtures.builders;
    expect(hex(returnKey(21, [10, 20, 110, 60], 0x5100, 7))).toBe(b.returnKey);
    expect(hex(returnKey(3, [0, 0, 479, 271], 0x1234, 0xbeef, { sound: false, mode: 0x12, upload: false })))
      .toBe(b.returnKeyNoUpload);
    expect(hex(dataInput(22, [300, 50, 470, 80], 0x5200))).toBe(b.dataInput);
    expect(hex(dataInput(22, [1, 2, 3, 4], 0x5202, { vType: 0, nInt: 3, nDot: 0, limits: null })))
      .toBe(b.dataInputNoLimits);
  });

  it("head read/write is lossless", () => {
    const t = TouchFile.parse(read(fixtures.sets.vendor.dir, "13_touch.bin"));
    for (const e of t.entries) expect(equal(writeHead(e, readHead(e)), e)).toBe(true);
  });

  it("add keeps entries grouped by page", () => {
    const t = new TouchFile([returnKey(1, [0, 0, 1, 1], 1, 1), returnKey(3, [0, 0, 1, 1], 1, 1)]);
    t.add(returnKey(2, [0, 0, 1, 1], 1, 1));
    t.add(returnKey(1, [0, 0, 1, 1], 1, 2));
    expect(t.entries.map(TouchFile.pageOf)).toEqual([1, 1, 2, 3]);
    t.removePage(1);
    expect(t.pages()).toEqual([2, 3]);
  });

  it("rejects garbage", () => {
    expect(() => TouchFile.parse(new Uint8Array([0xff, 0xff, 0]))).toThrow(/after terminator/);
    expect(() => TouchFile.parse(new Uint8Array(10))).toThrow(/truncated/);
    const bad = returnKey(1, [0, 0, 1, 1], 1, 1);
    bad[15] = 0x7f;
    expect(() => TouchFile.parse(new TouchFile([bad]).build())).toThrow(/unknown touch function/);
  });
});

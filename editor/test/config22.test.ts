import { describe, expect, it } from "vitest";
import { SramInit, equal } from "../src/core";
import { VENDOR_SET, read } from "./util";

describe("22*.BIN SRAM init", () => {
  it("round trip is byte-identical", () => {
    const data = read(VENDOR_SET, "22_config.bin");
    const s = SramInit.parse(data);
    expect(equal(s.build(), data)).toBe(true);
    expect(s.runs()).toEqual([]);
  });

  it("set / runs / fromRuns", () => {
    const s = new SramInit();
    s.set(0x1000, 1);
    s.set(0x1001, 2);
    s.set(0x2000, 0xffff);
    const runs = s.runs();
    expect(runs).toEqual([{ vp: 0x1000, words: [1, 2] }, { vp: 0x2000, words: [0xffff] }]);
    expect(equal(SramInit.fromRuns(runs).build(), s.build())).toBe(true);
    expect(() => s.set(0x10003, 1)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { VariableFile, equal, hex, parseTextVar, textVar, varType } from "../src/core";
import { fixtures, read } from "./util";

describe("14*.BIN variable file", () => {
  for (const [key, set] of Object.entries<any>(fixtures.sets)) {
    it(`${key}: parse -> build is byte-identical`, () => {
      const data = read(set.dir, "14_variable.bin");
      expect(equal(VariableFile.parse(data).build(), data)).toBe(true);
    });

    it(`${key}: decodes like screen_files.py`, () => {
      const v = VariableFile.parse(read(set.dir, "14_variable.bin"));
      const counts = Object.fromEntries([...v.pages].map(([p, es]) => [String(p), es.length]));
      expect(counts).toEqual(set.varPages);
      expect(v.trailer.length).toBe(set.trailer);
      const texts: Record<string, unknown> = {};
      for (const [p, es] of v.pages) {
        const ts = es.map(parseTextVar).filter((t) => t);
        if (ts.length) texts[String(p)] = ts;
      }
      expect(texts).toEqual(set.textVars);
    });
  }

  it("textVar matches screen_files.py", () => {
    expect(hex(textVar(0x5110, 12, 34, [10, 30, 150, 60], 20))).toBe(fixtures.builders.textVar);
  });

  it("empty file round trip, page index grows", () => {
    const v = VariableFile.empty();
    v.add(5, textVar(0x5000, 0, 0, [0, 0, 10, 10], 4));
    const again = VariableFile.parse(v.build());
    expect([...again.pages.keys()]).toEqual([5]);
    expect(varType(again.pages.get(5)![0]!)).toBe(0x11);
  });
});

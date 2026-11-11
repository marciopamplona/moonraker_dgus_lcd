import { describe, expect, it } from "vitest";
import { baudValue, cfgBaud, decodeCfg, defaultCfgBytes, encodeCfg, equal, hex } from "../src/core";
import { VENDOR_SET, fixtures, read } from "./util";

describe("T5UID1.CFG", () => {
  const data = read(VENDOR_SET, "T5UID1.CFG");

  it("decodes DGUS-reloaded's config", () => {
    const c = decodeCfg(data);
    expect(c.rotation).toBe(0);
    expect(c.sdEnabled).toBe(true);
    expect(c.touchTone).toBe(true);
    expect(c.init22).toBe(true);
    expect(c.autoUpload).toBe(false);
    expect(cfgBaud(data)).toBeCloseTo(fixtures.cfg.baud);
  });

  it("decode -> encode is byte-identical", () => {
    expect(equal(encodeCfg(decodeCfg(data), data), data)).toBe(true);
    const d = defaultCfgBytes();
    expect(equal(encodeCfg(decodeCfg(d), d), d)).toBe(true);
  });

  it("baud values match screen_files.py", () => {
    for (const [baud, v] of Object.entries<number>(fixtures.builders.baud)) {
      expect(baudValue(Number(baud))).toBe(v);
    }
    const c = decodeCfg(data);
    c.baudValue = baudValue(250000);
    expect(hex(encodeCfg(c, data))).toBe(fixtures.cfg.set250000);
    expect(() => baudValue(1000)).toThrow(/out of range/);
  });

  it("edits fields", () => {
    const c = decodeCfg(data);
    c.rotation = 270;
    c.bootPageEn = true;
    c.bootPage = 3;
    const d = decodeCfg(encodeCfg(c, data));
    expect(d.rotation).toBe(270);
    expect(d.bootPageEn).toBe(true);
    expect(d.bootPage).toBe(3);
  });

  it("rejects non-CFG data", () => expect(() => decodeCfg(new Uint8Array(128))).toThrow());
});

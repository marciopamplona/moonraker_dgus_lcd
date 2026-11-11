import { describe, expect, it } from "vitest";
import {
  DGUS_RELOADED_RULES, Simulator, blankProject, decompile, describeTouch, detectHostRules, fromHex, hostRules,
  hostTarget, returnKey,
} from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { VENDOR_SET, list, read } from "./util";

const vendor = () => decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;

describe("host rules", () => {
  it("detects DGUS-reloaded's page switching, nothing for a blank project", () => {
    expect(detectHostRules(vendor()).map((r) => r.vp)).toEqual([0x2000, 0x2002, 0x2003]);
    expect(detectHostRules(blankProject())).toEqual([]);
  });

  it("saved rules win over detection", () => {
    const doc = vendor();
    doc.project.sim = { rules: [{ vp: 0x1234, value: 1, page: 5 }] };
    expect(hostRules(doc)).toEqual({ rules: [{ vp: 0x1234, value: 1, page: 5 }], detected: false });
    expect(hostTarget(doc.project.sim.rules, 0x1234, 1)).toBe(5);
    expect(hostTarget(doc.project.sim.rules, 0x1234, 2)).toBeNull();
  });

  it("home -> settings in the simulator (the reported case)", () => {
    const doc = vendor();
    const home = doc.project.pages.find((p) => p.id === 1)!;
    const settings = home.touch.map((c) => fromHex(c.bytes))
      .find((e) => { const i = describeTouch(e); return i.vp === 0x2000 && i.fields.find((f) => f.name === "Key_Code")!.value === 9; })!;
    expect(settings).toBeDefined();
    const sim = new Simulator(1, hostRules(doc).rules, doc.project.pages.map((p) => p.id));
    const r = sim.press(settings);
    expect(r.events).toContainEqual({ type: "jump", page: 9, via: "host" });
    expect(sim.page).toBe(9);
  });

  it("every 0x2000 key on every page leads to an existing page", () => {
    const doc = vendor();
    const ids = doc.project.pages.map((p) => p.id);
    for (const pg of doc.project.pages) {
      for (const c of pg.touch) {
        const e = fromHex(c.bytes);
        if (describeTouch(e).vp !== 0x2000) continue;
        const sim = new Simulator(pg.id, DGUS_RELOADED_RULES, ids);
        sim.press(e);
        expect(ids).toContain(sim.page);
      }
    }
  });

  it("reports host jumps to missing pages instead of going there", () => {
    const sim = new Simulator(0, DGUS_RELOADED_RULES, [0, 1]);
    const r = sim.press(returnKey(0, [0, 0, 9, 9], 0x2000, 42));
    expect(sim.page).toBe(0);
    expect(r.events.some((e) => e.type === "info" && /42/.test(e.text))).toBe(true);
  });
});

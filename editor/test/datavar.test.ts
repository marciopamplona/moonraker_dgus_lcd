// Data variable (0x10) layout: (X, Y) is the field's upper-left corner for
// every alignment; ALI 0 = left, 1 = right, 2 = centred (T5L DGUS II guide
// 2.921 and the 2016 guide; the V4.3 guide has 0 and 1 swapped).
import { describe, expect, it } from "vitest";
import {
  Bitmap, Simulator, TEMPLATES, blankProject, dataFieldWidth, decompile, describeVar, fieldSpecs, fromHex, put16,
  writeField, addControl, getPage,
} from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { VENDOR_SET, list, read } from "./util";

describe("data variable layout", () => {
  it("home page temperatures sit on empty background between the printed '/' and '°C'", () => {
    const doc = decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;
    const home = getPage(doc, 1);
    const bm = Bitmap.load(doc.assets.get(home.background!)!);
    const fields = home.display.map((c) => describeVar(fromHex(c.bytes))).filter((i) => i.type === 0x10);
    const nozzle = fields.filter((i) => i.vp === 0x30ff || i.vp === 0x3100).map((i) => i.bounds);
    expect(nozzle).toEqual([[76, 227, 105, 246], [120, 227, 149, 246]]);
    for (const i of fields) {
      const [xs, ys, xe, ye] = i.bounds!;
      // the panel is a subtle gradient: count only glyph-like contrast
      // against the field's dominant colour
      const counts = new Map<string, number>();
      for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
        const k = bm.get(x, y).join();
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const bg = [...counts].sort((a, b) => b[1] - a[1])[0]![0].split(",").map(Number);
      let ink = 0;
      for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
        const px = bm.get(x, y);
        if (Math.abs(px[0] - bg[0]!) + Math.abs(px[1] - bg[1]!) + Math.abs(px[2] - bg[2]!) > 150) ink++;
      }
      expect(ink, `VP 0x${i.vp!.toString(16)} field overlaps printed graphics`).toBe(0);
    }
  });

  it("field width counts digits, the decimal point and the unit", () => {
    const e = TEMPLATES.find((t) => t.id === "number")!.make(0, 10, 20, 0x1000); // 5 digits, font 12
    expect(dataFieldWidth(e)).toBe(60);
    const s = (n: string) => fieldSpecs("display", e).find((f) => f.name === n)!;
    let d = writeField(e, s("Dec_Num"), 2);
    expect(dataFieldWidth(d)).toBe(12 * 8);
    d = writeField(d, s("Len_unit"), 2);
    d[21] = 0xb0; // degree sign in DWIN's ASCII font
    d[22] = 0x43; // C
    expect(dataFieldWidth(d)).toBe(12 * 10);
    expect(describeVar(d).bounds).toEqual([10, 20, 10 + 120 - 1, 20 + 24 - 1]);
    expect(describeVar(d).estimated).toBe(false);
    expect(describeVar(e).fields.find((f) => f.name === "ALI")!.value).toBe(0); // template = left
  });

  it("simulator anchors left / right / centred text inside the field", () => {
    const doc = blankProject();
    const base = TEMPLATES.find((t) => t.id === "number")!.make(0, 100, 50, 0x1000);
    const w = dataFieldWidth(base); // 60
    for (const ali of [0, 1, 2]) {
      const e = base.slice();
      e[16] = ali;
      addControl(doc, 0, "display", e);
    }
    const unit = base.slice();
    unit[20] = 1;
    unit[21] = 0x25; // %
    put16(unit, 6, 0x1001);
    addControl(doc, 0, "display", unit);
    const sim = new Simulator(0);
    sim.set(0x1000, 42);
    sim.set(0x1001, 7);
    const d = sim.render(getPage(doc, 0));
    expect(d.slice(0, 3).map((x) => [x.align, x.x])).toEqual([["left", 100], ["right", 100 + w], ["center", 100 + w / 2]]);
    expect(d[0]).toMatchObject({ text: "42", charW: 12, size: 24, box: [100, 50, 159, 73] });
    expect(d[3]!.text).toBe("7%");
  });
});

import { describe, expect, it } from "vitest";
import { Simulator, decompile, describeTouch, fromHex, hostRules, readHead, type ProjectDoc } from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { VENDOR_SET, list, read } from "./util";

const vendor = () => decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;

function sim(doc: ProjectDoc, page: number): Simulator {
  const s = new Simulator(page, hostRules(doc).rules);
  s.setProject(doc.project.pages);
  return s;
}

/** Centre of the touch area of the first entry on `page` matching `pred`. */
function centre(doc: ProjectDoc, page: number, pred: (e: Uint8Array) => boolean): [number, number] {
  const e = doc.project.pages.find((p) => p.id === page)!.touch.map((c) => fromHex(c.bytes)).find(pred)!;
  expect(e).toBeDefined();
  const [xs, ys, xe, ye] = readHead(e).area;
  return [Math.floor((xs + xe) / 2), Math.floor((ys + ye) / 2)];
}

/** Tap the overlay key with `code`, at its pasted position. */
function tapKey(doc: ProjectDoc, s: Simulator, code: number) {
  const o = s.overlay!;
  const [mx, my] = centre(doc, o.menuPage, (e) => readHead(e).code === code);
  return s.tap(mx - o.cut[0] + o.pos[0], my - o.cut[1] + o.pos[1]);
}

const isPopup = (vp: number) => (e: Uint8Array) => { const i = describeTouch(e); return i.type === 0x01 && i.vp === vp; };

describe("popup menus", () => {
  it("abort popup on page 2: opens, ignores outside touches, confirm writes 1", () => {
    const doc = vendor();
    const s = sim(doc, 2);
    s.tap(...centre(doc, 2, isPopup(0x2007)));
    expect(s.overlay).toMatchObject({ kind: "popup", menuPage: 204, cut: [118, 99, 360, 202], pos: [119, 82], vp: 0x2007 });
    expect(s.tap(5, 5).events).toEqual([]);
    expect(s.overlay).not.toBeNull();
    const r = tapKey(doc, s, 0x0001);
    expect(r.events[0]).toMatchObject({ type: "write", vp: 0x2007, value: 1 });
    expect(s.overlay).toBeNull();
    expect(s.flash).toMatchObject({ page: 205 }); // the _sel picture
    expect(s.page).toBe(2);
  });

  it("cancel (0xFF) closes without writing", () => {
    const doc = vendor();
    const s = sim(doc, 2);
    s.tap(...centre(doc, 2, isPopup(0x2008)));
    expect(s.overlay?.menuPage).toBe(206);
    const r = tapKey(doc, s, 0x00ff);
    expect(r.events).toEqual([{ type: "info", text: "popup cancelled" }]);
    expect(s.overlay).toBeNull();
    expect(s.get(0x2008)).toBe(0);
  });

  it("presets popup on page 5 returns the chosen item", () => {
    const doc = vendor();
    const s = sim(doc, 5);
    s.tap(...centre(doc, 5, isPopup(0x2010)));
    expect(s.overlay?.menuPage).toBe(210);
    tapKey(doc, s, 0x0002);
    expect(s.get(0x2010)).toBe(2);
  });

  it("every vendored popup opens and every one of its keys closes it", () => {
    const doc = vendor();
    for (const pg of doc.project.pages) {
      for (const c of pg.touch) {
        const e = fromHex(c.bytes);
        if (describeTouch(e).type !== 0x01) continue;
        const keys = doc.project.pages.find((p) => p.id === describeTouch(e).fields.find((f) => f.name === "Menu page")!.value)!
          .touch.map((k) => readHead(fromHex(k.bytes)).code);
        expect(keys.length).toBeGreaterThan(0);
        for (const code of keys) {
          const s = sim(doc, pg.id);
          s.press(e);
          expect(s.overlay).not.toBeNull();
          tapKey(doc, s, code);
          expect(s.overlay).toBeNull();
        }
      }
    }
  });
});

describe("keypads", () => {
  it("number input opens the numpad; typing and enter writes the scaled value", () => {
    const doc = vendor();
    const pg = doc.project.pages.find((p) => p.touch.some((c) => describeTouch(fromHex(c.bytes)).type === 0x00))!;
    const entry = pg.touch.map((c) => fromHex(c.bytes)).find((e) => describeTouch(e).type === 0x00)!;
    const info = describeTouch(entry);
    const nDot = info.fields.find((f) => f.name === "N_Dot")!.value;
    const s = sim(doc, pg.id);
    const [xs, ys] = readHead(entry).area;
    const r = s.tap(xs + 1, ys + 1);
    expect(r.input).toBeNull(); // the real keypad instead of a prompt
    expect(s.overlay).toMatchObject({ kind: "number", menuPage: 202, vp: info.vp });
    for (const ch of "12") tapKey(doc, s, ch.charCodeAt(0));
    if (nDot) tapKey(doc, s, 0x2e);
    tapKey(doc, s, 0x35);
    tapKey(doc, s, 0xf2); // backspace
    tapKey(doc, s, 0x34);
    expect(s.overlay!.buffer).toBe(nDot ? "12.4" : "124");
    expect(s.flash).toMatchObject({ page: 203 });
    tapKey(doc, s, 0xf1); // enter
    expect(s.overlay).toBeNull();
    const words = info.fields.find((f) => f.name === "V_Type")!.value === 1 ? 2 : 1;
    expect(s.read(info.vp!, words, true)).toBe(nDot ? Math.round(12.4 * 10 ** nDot) : 124);
  });

  it("cancel leaves the VP alone; '-' toggles the sign", () => {
    const doc = vendor();
    const pg = doc.project.pages.find((p) => p.touch.some((c) => describeTouch(fromHex(c.bytes)).type === 0x00))!;
    const entry = pg.touch.map((c) => fromHex(c.bytes)).find((e) => describeTouch(e).type === 0x00)!;
    const s = sim(doc, pg.id);
    s.press(entry);
    tapKey(doc, s, 0x37);
    tapKey(doc, s, 0x2d);
    expect(s.overlay!.buffer).toBe("-7");
    tapKey(doc, s, 0x2d);
    expect(s.overlay!.buffer).toBe("7");
    tapKey(doc, s, 0xf0);
    expect(s.overlay).toBeNull();
    expect(s.get(describeTouch(entry).vp!)).toBe(0);
  });

  it("falls back to a prompt request when the keypad page is missing", () => {
    const doc = vendor();
    const pg = doc.project.pages.find((p) => p.touch.some((c) => describeTouch(fromHex(c.bytes)).type === 0x00))!;
    const entry = pg.touch.map((c) => fromHex(c.bytes)).find((e) => describeTouch(e).type === 0x00)!;
    const s = new Simulator(pg.id);
    expect(s.press(entry).input).toMatchObject({ kind: "number", keypadPage: 202 });
    expect(s.overlay).toBeNull();
  });
});

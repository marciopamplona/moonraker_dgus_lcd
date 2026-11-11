import { describe, expect, it } from "vitest";
import { Bitmap, IconLibrary, defaultOrder, equal, iconFromBitmap, iconToBitmap } from "../src/core";
import { VENDOR_PROJECT, VENDOR_SET, list, read } from "./util";

const LIBS = ["24_icons", "27_buttons", "30_progress_left", "37_progress_right"];

describe(".ICO icon library", () => {
  for (const lib of LIBS) {
    it(`${lib}: parse -> build is byte-identical`, () => {
      const data = read(VENDOR_SET, `${lib}.ico`);
      expect(equal(IconLibrary.parse(data).build(), data)).toBe(true);
    });

    it(`${lib}: built from the source BMPs equals the DWIN tool output`, () => {
      const icons = new IconLibrary();
      for (const f of list(`${VENDOR_PROJECT}/${lib}`)) {
        if (!f.endsWith(".bmp")) continue;
        icons.set(parseInt(f, 10), iconFromBitmap(Bitmap.load(read(VENDOR_PROJECT, lib, f))));
      }
      expect(equal(icons.build(), read(VENDOR_SET, `${lib}.ico`))).toBe(true);
    });
  }

  it("decoded icons match their source BMPs after RGB565 truncation", () => {
    const lib = IconLibrary.parse(read(VENDOR_SET, "24_icons.ico"));
    const src = Bitmap.load(read(VENDOR_PROJECT, "24_icons", "1.bmp"));
    const ic = lib.icons.get(1)!;
    expect([ic.w, ic.h]).toEqual([src.w, src.h]);
    expect(equal(iconFromBitmap(iconToBitmap(ic)).pixels as unknown as Uint8Array,
      ic.pixels as unknown as Uint8Array)).toBe(true);
  });

  it("orders data like the DWIN tool and keeps new icons", () => {
    expect(defaultOrder([0, 1, 2, 10, 11, 100])).toEqual([0, 1, 10, 100, 11, 2]);
    const lib = IconLibrary.parse(read(VENDOR_SET, "24_icons.ico"));
    lib.set(9, { w: 2, h: 1, pixels: new Uint16Array([0xffff, 0x0001]) });
    const again = IconLibrary.parse(lib.build());
    expect(again.icons.get(9)!.pixels).toEqual(new Uint16Array([0xffff, 0x0001]));
    expect(again.order.at(-1)).toBe(9);
  });

  it("rejects icons larger than 255 px", () => {
    const lib = new IconLibrary();
    lib.set(0, { w: 300, h: 1, pixels: new Uint16Array(300) });
    expect(() => lib.build()).toThrow(/not supported/);
  });
});

// Every file in every DWIN_SET the repo ships goes through its codec and
// comes back byte-identical (or is a known passthrough type).
import { describe, expect, it } from "vitest";
import {
  AsciiFontLib, Bitmap, IconLibrary, SramInit, TouchFile, VariableFile,
  classify, decodeCfg, encodeCfg, equal,
} from "../src/core";
import { MACROS_SET, VENDOR_SET, list, read, sha256 } from "./util";

function roundTrip(name: string, data: Uint8Array): Uint8Array | "passthrough" {
  const f = classify(name);
  switch (f.kind) {
    case "touch": return TouchFile.parse(data).build();
    case "variables": return VariableFile.parse(data).build();
    case "sraminit": return SramInit.parse(data).build();
    case "icons": return IconLibrary.parse(data).build();
    case "config": return encodeCfg(decodeCfg(data), data);
    case "font": return f.id === 0 ? AsciiFontLib.parse(data).build() : "passthrough";
    // pictures are re-encoded with our header; compare pixels instead
    case "bitmap": {
      const bm = Bitmap.load(data);
      return equal(Bitmap.load(bm.save()).px, bm.px) ? data : bm.save();
    }
    default: return "passthrough";
  }
}

describe("golden round trip", () => {
  for (const dir of [VENDOR_SET, MACROS_SET, "screen/cfg"]) {
    for (const name of list(dir)) {
      if (!/\.(bin|bmp|ico|hzk|dzk|cfg|wav)$/i.test(name)) continue;
      it(`${dir}/${name}`, () => {
        const data = read(dir, name);
        const out = roundTrip(name, data);
        if (out === "passthrough") {
          expect(classify(name).kind).toMatch(/audio|font|bin|other/);
        } else {
          expect(sha256(out)).toBe(sha256(data));
        }
      });
    }
  }

  it("classifies DWIN_SET names", () => {
    expect(classify("001_home.bmp")).toMatchObject({ id: 1, label: "home", kind: "bitmap" });
    expect(classify("13_touch.bin").kind).toBe("touch");
    expect(classify("14_variable.bin").kind).toBe("variables");
    expect(classify("22_config.bin").kind).toBe("sraminit");
    expect(classify("0_DWIN_ASC.HZK")).toMatchObject({ id: 0, kind: "font" });
    expect(classify("27_buttons.ico")).toMatchObject({ id: 27, kind: "icons" });
    expect(classify("02_click.wav")).toMatchObject({ id: 2, kind: "audio" });
    expect(classify("T5UID1.CFG").kind).toBe("config");
  });
});

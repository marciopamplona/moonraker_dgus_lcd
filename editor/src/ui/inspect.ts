// M0 smoke test: run every DWIN_SET file through its codec and report.
import {
  AsciiFontLib, Bitmap, IconLibrary, SramInit, TouchFile, VariableFile,
  classify, decodeCfg, encodeCfg, equal,
} from "../core";

export interface FileReport {
  name: string;
  kind: string;
  size: number;
  status: "ok" | "differs" | "passthrough" | "error";
  detail: string;
  preview?: Bitmap;
}

export function inspect(name: string, data: Uint8Array): FileReport {
  const f = classify(name);
  const r: FileReport = { name, kind: f.kind, size: data.length, status: "ok", detail: "" };
  const same = (out: Uint8Array) => {
    r.status = equal(out, data) ? "ok" : "differs";
  };
  try {
    switch (f.kind) {
      case "touch": {
        const t = TouchFile.parse(data);
        same(t.build());
        r.detail = `${t.entries.length} touch areas on ${t.pages().length} pages`;
        break;
      }
      case "variables": {
        const v = VariableFile.parse(data);
        same(v.build());
        const n = [...v.pages.values()].reduce((a, e) => a + e.length, 0);
        r.detail = `${n} display variables on ${v.pages.size} pages`;
        break;
      }
      case "sraminit": {
        const s = SramInit.parse(data);
        same(s.build());
        r.detail = `${s.runs().length} initialised VP ranges`;
        break;
      }
      case "icons": {
        const lib = IconLibrary.parse(data);
        same(lib.build());
        r.detail = `${lib.icons.size} icons`;
        break;
      }
      case "config": {
        const c = decodeCfg(data);
        same(encodeCfg(c, data));
        r.detail = `rotation ${c.rotation}°, baud ${Math.round(7833600 / c.baudValue)}`;
        break;
      }
      case "font":
        if (f.id === 0) {
          same(AsciiFontLib.parse(data).build());
          r.detail = "ASCII library, heights 8-128";
        } else {
          r.status = "passthrough";
          r.detail = "font kept as is (codec in M4)";
        }
        break;
      case "bitmap": {
        const bm = Bitmap.load(data);
        r.preview = bm;
        r.detail = `${bm.w}x${bm.h}`;
        break;
      }
      default:
        r.status = "passthrough";
    }
  } catch (e) {
    r.status = "error";
    r.detail = e instanceof Error ? e.message : String(e);
  }
  return r;
}

// A new empty project: one white 480x272 page, default CFG and 22*.BIN.
import { hex } from "../bytes";
import { Bitmap } from "../formats/bmp";
import { defaultCfgBytes } from "../formats/cfg";
import { SramInit } from "../formats/config22";
import { VariableFile } from "../formats/var14";
import { T5UID1 } from "../profile/t5uid1";
import { PROJECT_FORMAT, PROJECT_VERSION, newId, now, type ProjectDoc } from "./schema";

export function blankProject(name = "Untitled"): ProjectDoc {
  const { w, h } = T5UID1.screen;
  const bg = new Bitmap(w, h);
  bg.px.fill(0xff);
  const t = now();
  const assets = new Map<string, Uint8Array>([
    ["000_main.bmp", bg.save()],
    [T5UID1.cfgName, defaultCfgBytes()],
    ["22_config.bin", new SramInit().build()],
  ]);
  return {
    project: {
      format: PROJECT_FORMAT, version: PROJECT_VERSION, id: newId("p"), name, profile: "t5uid1",
      created: t, modified: t,
      pages: [{ id: 0, name: "main", background: "000_main.bmp", touch: [], display: [] }],
      files: [{ name: T5UID1.cfgName, kind: "config" }, { name: "22_config.bin", kind: "sraminit" }],
      touchFile: "13_touch.bin",
      variables: { file: "14_variable.bin", header: hex(VariableFile.empty().header), trailer: "" },
    },
    assets,
  };
}

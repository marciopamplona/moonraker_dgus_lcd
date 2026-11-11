// DWIN_SET files -> ProjectDoc.
import { hex } from "../bytes";
import { classify } from "../formats/dwinset";
import { TouchFile } from "../formats/touch13";
import { INDEX_OFF, VariableFile } from "../formats/var14";
import { PROJECT_FORMAT, PROJECT_VERSION, newId, now, type Page, type ProjectDoc } from "./schema";

export interface DecompileResult {
  doc: ProjectDoc;
  warnings: string[];
}

export function decompile(files: Map<string, Uint8Array>, name = "Imported project"): DecompileResult {
  const warnings: string[] = [];
  const assets = new Map<string, Uint8Array>();
  const pages = new Map<number, Page>();
  const page = (id: number): Page => {
    let p = pages.get(id);
    if (!p) pages.set(id, (p = { id, name: `Page ${id}`, background: null, touch: [], display: [] }));
    return p;
  };
  let touchFile = "13_touch.bin";
  let variables = { file: "14_variable.bin", header: hex(VariableFile.empty().header), trailer: "" };
  const other: { name: string; kind: ReturnType<typeof classify>["kind"] }[] = [];
  let sawTouch = false;
  let sawVars = false;

  for (const [fname, data] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const f = classify(fname);
    if (f.kind === "bitmap" && f.id !== null) {
      const p = page(f.id);
      if (p.background) {
        warnings.push(`${fname}: picture ${f.id} already comes from ${p.background}; kept as a plain file`);
        other.push({ name: f.name, kind: "other" });
        assets.set(f.name, data);
        continue;
      }
      p.background = f.name;
      if (f.label) p.name = f.label;
      assets.set(f.name, data);
    } else if (f.kind === "touch" && !sawTouch) {
      sawTouch = true;
      touchFile = f.name;
      for (const e of TouchFile.parse(data).entries) {
        page(TouchFile.pageOf(e)).touch.push({ uid: newId("t"), bytes: hex(e) });
      }
    } else if (f.kind === "variables" && !sawVars) {
      sawVars = true;
      const v = VariableFile.parse(data);
      variables = { file: f.name, header: hex(v.header.subarray(0, INDEX_OFF)), trailer: hex(v.trailer) };
      for (const [id, es] of [...v.pages].sort(([a], [b]) => a - b)) {
        for (const e of es) page(id).display.push({ uid: newId("d"), bytes: hex(e) });
      }
    } else {
      if (f.kind === "touch" || f.kind === "variables") warnings.push(`${fname}: second ${f.kind} file kept as is`);
      other.push({ name: f.name, kind: f.kind });
      assets.set(f.name, data);
    }
  }
  if (!sawTouch) warnings.push("no 13*.BIN touch file");
  if (!sawVars) warnings.push("no 14*.BIN variable file");
  const t = now();
  return {
    doc: {
      project: {
        format: PROJECT_FORMAT, version: PROJECT_VERSION, id: newId("p"), name, profile: "t5uid1",
        created: t, modified: t,
        pages: [...pages.values()].sort((a, b) => a.id - b.id),
        files: other,
        touchFile,
        variables,
      },
      assets,
    },
    warnings,
  };
}

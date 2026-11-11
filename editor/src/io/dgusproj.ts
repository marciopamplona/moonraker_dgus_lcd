// .dgusproj = zip of project.json + assets/<key>. Pictures and other DWIN
// files are stored under their DWIN_SET names.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { FormatError } from "../core/bytes";
import { PROJECT_FORMAT, PROJECT_VERSION, type Project, type ProjectDoc } from "../core/project/schema";

export const DGUSPROJ_EXT = ".dgusproj";

export function saveDgusproj(doc: ProjectDoc): Uint8Array {
  const z: Zippable = { "project.json": strToU8(JSON.stringify(doc.project, null, 1)) };
  for (const [k, v] of doc.assets) z[`assets/${k}`] = [v, { level: 6 }];
  return zipSync(z);
}

export function loadDgusproj(data: Uint8Array): ProjectDoc {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new FormatError("not a .dgusproj (zip) file");
  }
  const json = files["project.json"];
  if (!json) throw new FormatError("project.json missing");
  const project = migrate(JSON.parse(strFromU8(json)));
  const assets = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(files)) {
    if (k.startsWith("assets/") && !k.endsWith("/")) assets.set(k.slice(7), v);
  }
  return { project, assets };
}

export function migrate(p: unknown): Project {
  const o = p as Partial<Project>;
  if (!o || o.format !== PROJECT_FORMAT) throw new FormatError("not a DGUS Studio project");
  if ((o.version ?? 0) > PROJECT_VERSION) {
    throw new FormatError(`project version ${o.version} is newer than this editor (${PROJECT_VERSION})`);
  }
  return o as Project;
}

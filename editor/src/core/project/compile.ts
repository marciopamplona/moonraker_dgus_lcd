// ProjectDoc -> DWIN_SET files.
import { FormatError, fromHex } from "../bytes";
import { TouchFile } from "../formats/touch13";
import { VariableFile } from "../formats/var14";
import type { ProjectDoc } from "./schema";

export function compile(doc: ProjectDoc): Map<string, Uint8Array> {
  const { project: p, assets } = doc;
  const out = new Map<string, Uint8Array>();
  const asset = (key: string) => {
    const a = assets.get(key);
    if (!a) throw new FormatError(`missing asset ${key}`);
    return a;
  };
  const add = (name: string, data: Uint8Array) => {
    if (out.has(name)) throw new FormatError(`two files named ${name}`);
    out.set(name, data);
  };
  const pages = [...p.pages].sort((a, b) => a.id - b.id);
  for (const pg of pages) if (pg.background) add(pg.background, asset(pg.background));

  const touch = new TouchFile();
  for (const pg of pages) for (const c of pg.touch) touch.entries.push(fromHex(c.bytes));
  add(p.touchFile, touch.build());

  const vars = new VariableFile(fromHex(p.variables.header), new Map(), fromHex(p.variables.trailer));
  for (const pg of pages) for (const c of pg.display) vars.add(pg.id, fromHex(c.bytes));
  add(p.variables.file, vars.build());

  for (const f of p.files) add(f.name, asset(f.name));
  return out;
}

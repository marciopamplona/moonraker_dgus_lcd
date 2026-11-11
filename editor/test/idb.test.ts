import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { blankProject, decompile, equal } from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import * as idb from "../src/io/idb";
import { VENDOR_SET, list, read } from "./util";

describe("IndexedDB project store", () => {
  it("saves, lists, loads and deletes projects", async () => {
    const a = blankProject("A");
    const b = decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;
    b.project.modified = new Date(Date.now() + 1000).toISOString();
    await idb.saveProject(a);
    await idb.saveProject(b);
    const ls = await idb.listProjects();
    expect(ls.map((p) => p.id)).toEqual([b.project.id, a.project.id]);

    idb._reset();
    const back = (await idb.loadProject(b.project.id))!;
    expect(back.project).toEqual(b.project);
    expect([...back.assets.keys()].sort()).toEqual([...b.assets.keys()].sort());
    for (const [k, v] of b.assets) expect(equal(back.assets.get(k)!, v)).toBe(true);

    await idb.deleteProject(a.project.id);
    expect((await idb.listProjects()).map((p) => p.id)).toEqual([b.project.id]);
    expect(await idb.loadProject(a.project.id)).toBeNull();
  });

  it("autosave rewrites only changed assets and drops replaced ones", async () => {
    const doc = blankProject("C");
    await idb.saveProject(doc);
    const pic = new Uint8Array([1, 2, 3]);
    const next = { project: { ...doc.project, name: "C2" }, assets: new Map(doc.assets).set("000_main.bmp", pic) };
    await idb.saveProject(next);
    idb._reset();
    const back = (await idb.loadProject(doc.project.id))!;
    expect(back.project.name).toBe("C2");
    expect(back.assets.get("000_main.bmp")).toEqual(pic);
  });
});

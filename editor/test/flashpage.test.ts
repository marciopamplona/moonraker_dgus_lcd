import { describe, expect, it } from "vitest";
import { addControl, addPage, blankProject, decompile, describeTouch, fromHex, pageFileNames, pagePictureRefs, readHead, returnKey, writeHead } from "../src/core";
import { pickDwinSet } from "../src/io/dwinset";
import { VENDOR_SET, list, read } from "./util";

const vendor = () => decompile(pickDwinSet(list(VENDOR_SET).map((n) => [n, read(VENDOR_SET, n)]))).doc;

describe("flashing one page", () => {
  it("finds the pictures a page shows: popups, keypads, pressed states", () => {
    const doc = vendor();
    expect(pagePictureRefs(doc, 2)).toEqual([204, 206, 208]);
    expect(pagePictureRefs(doc, 5)).toEqual([210]);
    const withInput = doc.project.pages.find((p) => p.touch.some((c) => describeTouch(fromHex(c.bytes)).type === 0x00))!;
    expect(pagePictureRefs(doc, withInput.id)).toContain(202);
    expect(pagePictureRefs(doc, 1)).toEqual([]); // home: only host page switches
  });

  it("file list: picture(s) + 13 + 14; Pic_Next jumps don't count", () => {
    const doc = blankProject();
    addPage(doc, { id: 1, name: "sel" });
    addPage(doc, { id: 2, name: "next" });
    const k = returnKey(0, [0, 0, 9, 9], 0x1000, 1);
    addControl(doc, 0, "touch", writeHead(k, { ...readHead(k), picOn: 1, picNext: 2 }));
    expect(pagePictureRefs(doc, 0)).toEqual([1]);
    expect(pageFileNames(doc, 0)).toEqual(["000_main.bmp", "001_sel.bmp", "13_touch.bin", "14_variable.bin"]);
    expect(pageFileNames(doc, 0, false)).toEqual(["000_main.bmp", "13_touch.bin", "14_variable.bin"]);
  });
});

import { describe, expect, it } from "vitest";
import { lockedRatio, newLayer, resizeBox, type ImageLayer } from "../src/core";

describe("fixed aspect ratio", () => {
  it("is on by default for new and old image layers, off for shapes", () => {
    const img = newLayer("image", { x: 0, y: 0, w: 200, h: 100 }) as ImageLayer;
    expect(img.keepAspect).toBe(true);
    expect(lockedRatio(img)).toBe(2);
    const legacy = { ...img } as ImageLayer;
    delete legacy.keepAspect;
    expect(lockedRatio(legacy)).toBe(2);
    expect(lockedRatio({ ...img, keepAspect: false })).toBeNull();
    expect(lockedRatio({ ...img, ratio: 4 / 3 })).toBeCloseTo(4 / 3);
    expect(lockedRatio(newLayer("rect"))).toBeNull();
  });

  it("corners scale from the opposite corner", () => {
    expect(resizeBox([10, 10, 200, 100], "se", 40, 0, 2)).toEqual([10, 10, 240, 120]);
    expect(resizeBox([10, 10, 200, 100], "se", 0, 50, 2)).toEqual([10, 10, 300, 150]);
    // north-west: the bottom-right corner stays at (210, 110)
    const [x, y, w, h] = resizeBox([10, 10, 200, 100], "nw", 100, 0, 2);
    expect([w, h]).toEqual([100, 50]);
    expect([x + w, y + h]).toEqual([210, 110]);
  });

  it("edges resize and stay centred on the other axis", () => {
    expect(resizeBox([0, 100, 200, 100], "e", 100, 0, 2)).toEqual([0, 75, 300, 150]);
    expect(resizeBox([100, 0, 200, 100], "s", 0, 50, 2)).toEqual([50, 0, 300, 150]);
  });

  it("without a ratio the box follows the handle freely", () => {
    expect(resizeBox([10, 10, 200, 100], "se", 40, -30)).toEqual([10, 10, 240, 70]);
    expect(resizeBox([10, 10, 200, 100], "w", 20, 99)).toEqual([30, 10, 180, 100]);
  });
});

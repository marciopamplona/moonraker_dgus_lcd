import { describe, expect, it } from "vitest";
import { inspect } from "../src/ui/inspect";
import { MACROS_SET, VENDOR_SET, list, read } from "./util";

describe("UI inspect()", () => {
  for (const dir of [VENDOR_SET, MACROS_SET]) {
    it(`${dir}: no file differs or errors`, () => {
      const reports = list(dir).map((n) => inspect(n, read(dir, n)));
      const bad = reports.filter((r) => r.status === "differs" || r.status === "error");
      expect(bad).toEqual([]);
      expect(reports.some((r) => r.kind === "touch" && r.status === "ok")).toBe(true);
    });
  }
});

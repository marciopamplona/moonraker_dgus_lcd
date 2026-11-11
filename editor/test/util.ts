import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const VENDOR_SET = "vendor/DGUS-reloaded-Klipper/project/DWIN_SET";
export const VENDOR_PROJECT = "vendor/DGUS-reloaded-Klipper/project";
export const MACROS_SET = "screen/macros";

export function read(...p: string[]): Uint8Array {
  return new Uint8Array(readFileSync(join(REPO, ...p)));
}

export function list(dir: string): string[] {
  return readdirSync(join(REPO, dir)).sort();
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fixtures: any = JSON.parse(
  readFileSync(join(REPO, "editor/test/fixtures/screen_files.json"), "utf8"),
);

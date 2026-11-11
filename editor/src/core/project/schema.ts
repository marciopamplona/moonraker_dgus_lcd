// The editable project. It is JSON (project.json) plus binary assets kept
// by key (assets/<key> in a .dgusproj zip). Controls keep their exact
// bytes, so decompile -> compile is byte-identical; typed editing (M2) works
// on top of these bytes through the descriptors in controls/describe.ts.
import type { ArtFont, Artwork } from "../art/schema";
import type { DwinFileKind } from "../formats/dwinset";

export const PROJECT_FORMAT = "dgus-studio";
export const PROJECT_VERSION = 1;

export interface Control {
  uid: string;
  /** Raw entry, hex. Touch: 16-64 bytes; display: 32 bytes. */
  bytes: string;
}

export interface Page {
  id: number;
  name: string;
  /** Picture file (asset key = DWIN_SET file name), or null. */
  background: string | null;
  touch: Control[];
  display: Control[];
  /** Editable source of the picture (absent for imported pictures until
   * they are first edited). */
  art?: Artwork;
}

export interface ProjectFile {
  /** DWIN_SET file name, also the asset key. */
  name: string;
  kind: DwinFileKind;
}

/** Stand-in for the host (printer service) in the simulator: when `vp` is
 * written, switch page. Without `value`, the written value is the page id;
 * with it, switch to `page` when the written value equals `value`. */
export interface HostRule {
  vp: number;
  value?: number;
  page?: number;
  note?: string;
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  id: string;
  name: string;
  profile: "t5uid1";
  created: string;
  modified: string;
  /** Sorted by id. */
  pages: Page[];
  /** Everything that isn't a page picture or 13/14: icons, fonts, audio,
   * CFG, 22*.BIN, other bins. */
  files: ProjectFile[];
  touchFile: string; // e.g. "13_touch.bin"
  variables: { file: string; header: string; trailer: string };
  /** Fonts uploaded for text layers. */
  artFonts?: ArtFont[];
  /** Simulator settings; when absent, host rules are auto-detected. */
  sim?: { rules: HostRule[] };
}

/** A project with its binary assets. */
export interface ProjectDoc {
  project: Project;
  assets: Map<string, Uint8Array>;
}

let counter = 0;
export function newId(prefix = ""): string {
  counter = (counter + 1) % 0x10000;
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + counter.toString(36);
}

export function now(): string {
  return new Date().toISOString();
}

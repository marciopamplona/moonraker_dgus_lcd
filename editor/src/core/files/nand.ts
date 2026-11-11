// Where DWIN_SET files land in the screen's NAND (T5UID1): the 64 MB font
// space holds 256 ids of 256 KB; a file at id n fills consecutive ids from
// n. WAV files share the upper 32 MB at 128 KB per WAV id (docs/PROTOCOL.md).
import { classify } from "../formats/dwinset";
import type { ProjectDoc } from "../project/schema";

export const FONT_BLOCK = 256 * 1024;
export const FONT_SPACE = 64 * 1024 * 1024;
export const AUDIO_BASE = 32 * 1024 * 1024;
export const AUDIO_BLOCK = 128 * 1024;

export interface NandUse {
  name: string;
  /** Byte range [start, end) in the font space. */
  start: number;
  end: number;
  /** First and last 256 KB font id covered. */
  firstId: number;
  lastId: number;
}

const FONT_KINDS = new Set(["touch", "variables", "sraminit", "icons", "font", "bin"]);

export function nandUse(name: string, size: number): NandUse | null {
  const f = classify(name);
  if (f.id === null) return null;
  let start: number, len: number;
  if (FONT_KINDS.has(f.kind)) {
    start = f.id * FONT_BLOCK;
    len = Math.max(1, Math.ceil(size / FONT_BLOCK)) * FONT_BLOCK;
  } else if (f.kind === "audio") {
    start = AUDIO_BASE + f.id * AUDIO_BLOCK;
    len = Math.max(1, Math.ceil(size / AUDIO_BLOCK)) * AUDIO_BLOCK;
  } else return null;
  return { name, start, end: start + len, firstId: Math.floor(start / FONT_BLOCK), lastId: Math.floor((start + len - 1) / FONT_BLOCK) };
}

/** Sizes of the files the project compiles to, without compiling. */
export function fileSizes(doc: ProjectDoc): Map<string, number> {
  const p = doc.project;
  const m = new Map<string, number>();
  for (const f of p.files) m.set(f.name, doc.assets.get(f.name)?.length ?? 0);
  for (const pg of p.pages) if (pg.background) m.set(pg.background, doc.assets.get(pg.background)?.length ?? 0);
  m.set(p.touchFile, p.pages.reduce((n, pg) => n + pg.touch.reduce((k, c) => k + c.bytes.length / 2, 0), 0) + 2);
  m.set(p.variables.file, 0x4000 + p.pages.reduce((n, pg) => n + pg.display.length * 32, 0) + p.variables.trailer.length / 2);
  return m;
}

/** Every NAND file of the project (13/14 included), by position. */
export function nandUses(doc: ProjectDoc): NandUse[] {
  const out: NandUse[] = [];
  for (const [name, size] of fileSizes(doc)) {
    const u = nandUse(name, size);
    if (u) out.push(u);
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface NandProblem {
  kind: "overlap" | "range";
  names: string[];
  text: string;
}

export function nandProblems(uses: NandUse[]): NandProblem[] {
  const out: NandProblem[] = [];
  for (const u of uses) {
    if (u.end > FONT_SPACE) out.push({ kind: "range", names: [u.name], text: `${u.name} goes past the end of the 64 MB font space` });
  }
  for (let i = 0; i < uses.length; i++) {
    for (let j = i + 1; j < uses.length; j++) {
      const a = uses[i]!, b = uses[j]!;
      if (b.start >= a.end) break;
      out.push({
        kind: "overlap", names: [a.name, b.name],
        text: `${a.name} (ids ${a.firstId}–${a.lastId}) overlaps ${b.name} (ids ${b.firstId}–${b.lastId})`,
      });
    }
  }
  return out;
}

/** First font id >= `from` where `size` bytes fit without overlapping. */
export function freeFontId(uses: NandUse[], size: number, from = 24): number {
  const blocks = Math.max(1, Math.ceil(size / FONT_BLOCK));
  for (let id = from; id + blocks <= 128; id++) {
    const s = id * FONT_BLOCK, e = s + blocks * FONT_BLOCK;
    if (!uses.some((u) => u.start < e && s < u.end)) return id;
  }
  throw new Error("no free space in the font area");
}

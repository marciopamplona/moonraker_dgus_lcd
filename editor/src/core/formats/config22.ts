// 22*.BIN: SRAM (VP space) initial values, loaded at power on when
// System_Config1.5 is set in the CFG. Word n of the file = VP n,
// big-endian. DGUS-reloaded ships 131 076 zero bytes (64K words + 4);
// the length is kept as is.
import { FormatError, put16, u16 } from "../bytes";

export const CONFIG22_DEFAULT_SIZE = 0x20004;

export interface InitRun {
  vp: number;
  words: number[];
}

export class SramInit {
  data: Uint8Array;

  constructor(data?: Uint8Array) {
    this.data = data ? data.slice() : new Uint8Array(CONFIG22_DEFAULT_SIZE);
  }

  static parse(data: Uint8Array): SramInit {
    return new SramInit(data);
  }

  build(): Uint8Array {
    return this.data.slice();
  }

  get(vp: number): number {
    return u16(this.data, vp * 2);
  }

  set(vp: number, value: number): void {
    if (vp < 0 || vp * 2 + 2 > this.data.length) throw new FormatError(`VP 0x${vp.toString(16)} outside 22.bin`);
    put16(this.data, vp * 2, value);
  }

  /** Non-zero values grouped into runs of consecutive VPs. */
  runs(): InitRun[] {
    const runs: InitRun[] = [];
    let cur: InitRun | null = null;
    for (let vp = 0; vp * 2 + 1 < this.data.length; vp++) {
      const v = this.get(vp);
      if (v) {
        if (cur && cur.vp + cur.words.length === vp) cur.words.push(v);
        else runs.push((cur = { vp, words: [v] }));
      } else cur = null;
    }
    return runs;
  }

  static fromRuns(runs: InitRun[], size = CONFIG22_DEFAULT_SIZE): SramInit {
    const s = new SramInit(new Uint8Array(size));
    for (const r of runs) r.words.forEach((w, i) => s.set(r.vp + i, w));
    return s;
  }
}

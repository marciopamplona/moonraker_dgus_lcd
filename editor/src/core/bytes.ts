// Small helpers for big-endian binary formats (DWIN files are big-endian,
// except BMP which is little-endian).

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

export function u8(data: Uint8Array, off: number): number {
  const v = data[off];
  if (v === undefined) throw new FormatError(`read past end at 0x${off.toString(16)}`);
  return v;
}

export function u16(data: Uint8Array, off: number): number {
  return (u8(data, off) << 8) | u8(data, off + 1);
}

export function u24(data: Uint8Array, off: number): number {
  return (u8(data, off) << 16) | u16(data, off + 1);
}

export function u32(data: Uint8Array, off: number): number {
  return u16(data, off) * 0x10000 + u16(data, off + 2);
}

export function i32(data: Uint8Array, off: number): number {
  return u32(data, off) | 0;
}

export function put16(data: Uint8Array, off: number, v: number): void {
  data[off] = (v >>> 8) & 0xff;
  data[off + 1] = v & 0xff;
}

export function put24(data: Uint8Array, off: number, v: number): void {
  data[off] = (v >>> 16) & 0xff;
  put16(data, off + 1, v);
}

export function put32(data: Uint8Array, off: number, v: number): void {
  put16(data, off, (v >>> 16) & 0xffff);
  put16(data, off + 2, v & 0xffff);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function hex(data: Uint8Array): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** Copy of a byte range (never a view, so edits can't alias the source). */
export function slice(data: Uint8Array, start: number, end: number): Uint8Array {
  return data.slice(start, end);
}

// T5UID1*.CFG: 128-byte hardware configuration, read from the SD card only
// (T5UID1 Application Guide ch. 5). decode() gives named fields; encode()
// writes them over a base file, so unmodelled bytes are kept.
import { FormatError, put16, put24, u16, u8 } from "../bytes";

export const CFG_SIZE = 0x80;
export const CFG_MAGIC = [0x54, 0x35, 0x44, 0x31]; // "T5D1"
export const CFG_BAUD_CLOCK = 7833600;
export const CFG_BAUD_MAX = 0x03e7;

export interface T5uid1Config {
  // System_Config1 (0x08)
  autoUpload: boolean; // .7 = 0 means ON
  controls128: boolean; // .6 128 display controls per page (else 64)
  init22: boolean; // .5 load 22*.bin at power on
  sdEnabled: boolean; // .4
  touchTone: boolean; // .3
  backlightStandby: boolean; // .2
  rotation: 0 | 90 | 180 | 270; // .1-.0
  baudValue: number; // 0x09: 7833600 / baud
  ledSetEn: boolean; // 0x0B == 0x5A
  ledOn: number; // 0x0C brightness while touched
  ledIdle: number; // 0x0D brightness when idle
  ledIdleTime: number; // 0x0E, units of 5 ms
  bootPageEn: boolean; // 0x20 == 0x5A
  bootPage: number; // 0x21
  bootMusicEn: boolean; // 0x23 == 0x5A
  bootMusic: { id: number; blocks: number; volume: number }; // 0x24..0x26
  // System_Config2 (0x2C)
  buzzer: boolean; // .7 1 = buzzer, 0 = audio player
  uartCrc: boolean; // .6
  watchdog: boolean; // .5
  syncUpdate: boolean; // .4
}

export function checkCfg(data: Uint8Array): void {
  if (data.length < CFG_SIZE || CFG_MAGIC.some((b, i) => data[i] !== b)) {
    throw new FormatError("not a T5UID1 CFG file");
  }
}

const bit = (v: number, n: number) => ((v >> n) & 1) === 1;

export function decodeCfg(data: Uint8Array): T5uid1Config {
  checkCfg(data);
  const c1 = u8(data, 0x08);
  const c2 = u8(data, 0x2c);
  return {
    autoUpload: !bit(c1, 7),
    controls128: bit(c1, 6),
    init22: bit(c1, 5),
    sdEnabled: bit(c1, 4),
    touchTone: bit(c1, 3),
    backlightStandby: bit(c1, 2),
    rotation: ([0, 90, 180, 270] as const)[c1 & 3]!,
    baudValue: u16(data, 0x09),
    ledSetEn: u8(data, 0x0b) === 0x5a,
    ledOn: u8(data, 0x0c),
    ledIdle: u8(data, 0x0d),
    ledIdleTime: u16(data, 0x0e),
    bootPageEn: u8(data, 0x20) === 0x5a,
    bootPage: u16(data, 0x21),
    bootMusicEn: u8(data, 0x23) === 0x5a,
    bootMusic: { id: u8(data, 0x24), blocks: u8(data, 0x25), volume: u8(data, 0x26) },
    buzzer: bit(c2, 7),
    uartCrc: bit(c2, 6),
    watchdog: bit(c2, 5),
    syncUpdate: bit(c2, 4),
  };
}

/** Write `cfg` over a copy of `base`. Enable markers (0x5A) that were not
 * set in `base` are only written when the flag is true, and cleared to 0
 * when false, so an unchanged decode -> encode is byte-identical. */
export function encodeCfg(cfg: T5uid1Config, base: Uint8Array = defaultCfgBytes()): Uint8Array {
  checkCfg(base);
  const out = base.slice();
  const b = (v: boolean, n: number) => (v ? 1 << n : 0);
  out[0x08] =
    b(!cfg.autoUpload, 7) | b(cfg.controls128, 6) | b(cfg.init22, 5) | b(cfg.sdEnabled, 4) |
    b(cfg.touchTone, 3) | b(cfg.backlightStandby, 2) | ([0, 90, 180, 270].indexOf(cfg.rotation) & 3);
  if (cfg.baudValue < 1 || cfg.baudValue > CFG_BAUD_MAX) throw new FormatError("baud value out of range");
  put16(out, 0x09, cfg.baudValue);
  out[0x0b] = cfg.ledSetEn ? 0x5a : 0;
  out[0x0c] = cfg.ledOn;
  out[0x0d] = cfg.ledIdle;
  put16(out, 0x0e, cfg.ledIdleTime);
  out[0x20] = cfg.bootPageEn ? 0x5a : 0;
  put16(out, 0x21, cfg.bootPage);
  out[0x23] = cfg.bootMusicEn ? 0x5a : 0;
  put24(out, 0x24, (cfg.bootMusic.id << 16) | (cfg.bootMusic.blocks << 8) | cfg.bootMusic.volume);
  out[0x2c] = (out[0x2c]! & 0x0f) | b(cfg.buzzer, 7) | b(cfg.uartCrc, 6) | b(cfg.watchdog, 5) | b(cfg.syncUpdate, 4);
  return out;
}

/** A minimal CFG: magic, System_Config1 = 0xB8 (DGUS-reloaded), 115200. */
export function defaultCfgBytes(): Uint8Array {
  const d = new Uint8Array(CFG_SIZE);
  d.set(CFG_MAGIC);
  d[0x08] = 0xb8;
  put16(d, 0x09, 0x0044);
  return d;
}

/** Setting for `baud`; throws if the screen can't get within maxError. */
export function baudValue(baud: number, maxError = 0.015): number {
  const value = Math.round(CFG_BAUD_CLOCK / baud);
  if (!(value >= 1 && value <= CFG_BAUD_MAX)) throw new FormatError(`baud ${baud} out of range`);
  const actual = CFG_BAUD_CLOCK / value;
  if (Math.abs(actual - baud) / baud > maxError) {
    const pct = ((actual - baud) * 100) / baud;
    throw new FormatError(
      `baud ${baud} not possible: nearest is ${actual.toFixed(0)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
    );
  }
  return value;
}

export function actualBaud(value: number): number {
  return CFG_BAUD_CLOCK / value;
}

/** Used by tests to compare with screen_files.cfg_baud. */
export function cfgBaud(data: Uint8Array): number {
  checkCfg(data);
  return actualBaud(u16(data, 0x09));
}


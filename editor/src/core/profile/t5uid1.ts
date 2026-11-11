// Device profile: everything that differs between DWIN controllers. Only
// T5UID1 exists for now; a T5L profile would add ICL/JPEG pictures and its
// own system variables.

export interface DeviceProfile {
  id: "t5uid1";
  name: string;
  screen: { w: number; h: number };
  /** NAND font space: block size in bytes and number of blocks (ids). */
  fontSpace: { blockSize: number; blocks: number };
  /** Ids reserved by the system. */
  reservedIds: Record<number, string>;
  /** Picture formats the controller accepts. */
  pictureExts: string[];
  /** VP ranges the user may allocate (system variables are below 0x1000). */
  userVp: { start: number; end: number };
  cfgName: string;
}

export const T5UID1: DeviceProfile = {
  id: "t5uid1",
  name: "DWIN T5UID1 (e.g. DMT48270C043_06WT, Ender-6)",
  screen: { w: 480, h: 272 },
  fontSpace: { blockSize: 256 * 1024, blocks: 256 },
  reservedIds: { 0: "0_DWIN_ASC.HZK (12 blocks)", 13: "touch config", 14: "display variables", 22: "SRAM init" },
  pictureExts: ["bmp"],
  userVp: { start: 0x1000, end: 0x6fff },
  cfgName: "T5UID1.CFG",
};

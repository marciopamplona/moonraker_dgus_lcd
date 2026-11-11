# DGUS-reloaded-Klipper 1.0.2 release: compiled files

These are unmodified files from the DGUS-reloaded-Klipper **1.0.2** release
(`DWIN_SET.tar.gz`). The DGUS editor generates them from `DWprj.hmi`, and
upstream doesn't commit them, so `../DGUS-reloaded-Klipper/` doesn't have them.
`python -m dgus_lcd.sdcard` (`./make_sdcard.sh`) adds `DWIN_SET/` to the vendored
project's `DWIN_SET`, so building the SD card never downloads anything.

| File | Use | SHA-256 |
|---|---|---|
| `13_touch.bin` | touch areas (stock; `screen/macros/` has the patched one) | `d9470d6a…cbb9` |
| `14_variable.bin` | display variables (stock; patched in `screen/macros/`) | `7ca1113d…bee0` |
| `22_config.bin` | start-up variable values | `1215d346…acf` |

Source: https://github.com/Desuuuu/DGUS-reloaded-Klipper/releases/tag/1.0.2
(GPL-3.0, like the rest of the project).

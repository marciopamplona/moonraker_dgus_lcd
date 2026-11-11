# Vendored projects

Plain, unmodified third-party files. They are not submodules, and the
service doesn't use them at runtime. `screen/` holds only our patched files;
the builders (`macros_screen`, `sdcard`) read their stock inputs from here.

| Folder | Source | Commit | License |
|---|---|---|---|
| `DGUS-reloaded-Klipper/` | https://github.com/Desuuuu/DGUS-reloaded-Klipper | `39301e5` (2021-08-22), VERSION 1.0.2 | see its `LICENSE` |
| `DGUS-reloaded-Klipper-release/` | the 1.0.2 release `DWIN_SET.tar.gz` | only `13_touch.bin`, `14_variable.bin`, `22_config.bin` (missing from the project copy) | GPL-3.0 |
| `selawik/` | Microsoft Selawik font (`selawk.ttf`), used to draw the static Macros titles | | OFL, `LICENSE-Selawik.txt` |

`DGUS-reloaded-Klipper/` holds the DGUS project the screen firmware (`DWIN_SET`) is built from.
`dgus_lcd/macros_screen.py` patches the compiled 1.0.2 release files, not
this source.

`project/DWIN_SET/` is identical to the 1.0.2 release's, except that the
compiled `13_touch.bin`, `14_variable.bin` and `22_config.bin` are missing.
The DGUS editor generates them from `DWprj.hmi`, and upstream doesn't
commit them, so they are in `DGUS-reloaded-Klipper-release/DWIN_SET/`.

To refresh a copy:

```sh
rm -rf vendor/DGUS-reloaded-Klipper
git clone --depth 1 https://github.com/Desuuuu/DGUS-reloaded-Klipper.git vendor/DGUS-reloaded-Klipper
rm -rf vendor/DGUS-reloaded-Klipper/.git
```

Then update the commit in the table above.

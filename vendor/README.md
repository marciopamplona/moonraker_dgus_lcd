# Vendored projects

Plain copies kept for reference only. They are not submodules and the
service doesn't use them at runtime.

| Folder | Source | Commit | License |
|---|---|---|---|
| `DGUS-reloaded-Klipper/` | https://github.com/Desuuuu/DGUS-reloaded-Klipper | `39301e5` (2021-08-22), VERSION 1.0.2 | see its `LICENSE` |

It holds the DGUS project the screen firmware (`DWIN_SET`) is built from.
`dgus_lcd/macros_screen.py` patches the compiled 1.0.2 release files, not
this source.

`project/DWIN_SET/` is identical to the 1.0.2 release's, except that the
compiled `13_touch.bin`, `14_variable.bin` and `22_config.bin` are missing.
The DGUS editor generates them from `DWprj.hmi`, so take them from the
release.

To refresh a copy:

```sh
rm -rf vendor/DGUS-reloaded-Klipper
git clone --depth 1 https://github.com/Desuuuu/DGUS-reloaded-Klipper.git vendor/DGUS-reloaded-Klipper
rm -rf vendor/DGUS-reloaded-Klipper/.git
```

Then update the commit in the table above.

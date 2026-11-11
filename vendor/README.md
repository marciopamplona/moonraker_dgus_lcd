# Vendored projects

Plain third-party copies. They are not submodules, and the service doesn't
use them at runtime. The builders (`macros_screen`, `sdcard`) read their
stock inputs from here, and `screen/` holds the files this repo adds or
patches.

| Folder | Source | Commit | License |
|---|---|---|---|
| `DGUS-reloaded-Klipper/` | https://github.com/Desuuuu/DGUS-reloaded-Klipper | `39301e5` (2021-08-22), VERSION 1.0.2 | GPL-3.0, see its `LICENSE` |

`DGUS-reloaded-Klipper/` holds the DGUS project the screen firmware
(`DWIN_SET`) is built from.

## Added to the clone

`project/DWIN_SET/` was missing the three files the DGUS editor compiles
from `DWprj.hmi`. Upstream doesn't commit them: its `.gitignore` has
`project/DWIN_SET/*.bin`. They were added, unmodified, from the 1.0.2
release (`DWIN_SET.tar.gz`,
https://github.com/Desuuuu/DGUS-reloaded-Klipper/releases/tag/1.0.2):

| File | Use | SHA-256 |
|---|---|---|
| `13_touch.bin` | touch areas | `d9470d6adff9d66034120e6f65491f58a82b0f42cb27d270923560a01ee7cbb9` |
| `14_variable.bin` | display variables | `7ca1113d2f147320f54c11b915f38d2287373a5ee631083357b66bd6bf46bee0` |
| `22_config.bin` | start-up variable values | `1215d346158e9a351457198d6da53678bd6005ef90d1870e7685ae9a27b76acf` |

With them, `project/DWIN_SET/` is byte-identical to the release's
`DWIN_SET`. Because of the upstream `.gitignore`, git only tracks them
because they were added with `git add -f`. A plain `git add` won't pick
up a replaced copy.

## Refreshing

```sh
rm -rf vendor/DGUS-reloaded-Klipper
git clone --depth 1 https://github.com/Desuuuu/DGUS-reloaded-Klipper.git vendor/DGUS-reloaded-Klipper
rm -rf vendor/DGUS-reloaded-Klipper/.git
# then put the three compiled files from the matching release back
# and add them with: git add -f vendor/DGUS-reloaded-Klipper/project/DWIN_SET/*.bin
```

Update the commit and the checksums above.

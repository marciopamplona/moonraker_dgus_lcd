#!/usr/bin/env python3
"""Write test/fixtures/screen_files.json from dgus_lcd/screen_files.py, the
reference implementation, so the TypeScript codecs can be cross-checked.

    cd editor && npm run fixtures
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)
from dgus_lcd import screen_files as sf  # noqa: E402

SETS = {
    "vendor": "vendor/DGUS-reloaded-Klipper/project/DWIN_SET",
    "macros": "screen/macros",
}


def rd(*p):
    with open(os.path.join(REPO, *p), "rb") as f:
        return f.read()


def main():
    out = {"sets": {}, "builders": {}}
    for key, d in SETS.items():
        t = sf.TouchFile.parse(rd(d, "13_touch.bin"))
        v = sf.VariableFile.parse(rd(d, "14_variable.bin"))
        keys = [sf.parse_return_key(e) for e in t.entries]
        texts = {p: [sf.parse_text_var(e) for e in es if sf.parse_text_var(e)]
                 for p, es in v.pages.items()}
        out["sets"][key] = {
            "dir": d,
            "touchCount": len(t.entries),
            "touchPages": t.pages(),
            "returnKeys": [k for k in keys if k],
            "varPages": {str(p): len(es) for p, es in v.pages.items()},
            "textVars": {str(p): ts for p, ts in texts.items() if ts},
            "trailer": len(v.trailer),
        }
    bmps = {}
    vd = SETS["vendor"]
    for name in sorted(os.listdir(os.path.join(REPO, vd))):
        if name.lower().endswith(".bmp"):
            bm = sf.Bitmap.load(rd(vd, name))
            bmps[name] = {
                "w": bm.w, "h": bm.h,
                "pixels": hashlib.sha256(bytes(bm.px)).hexdigest(),
                "save": hashlib.sha256(bm.save()).hexdigest(),
            }
    out["bitmaps"] = bmps
    cfg = rd(vd, "T5UID1.CFG")
    out["cfg"] = {"baud": sf.cfg_baud(cfg),
                  "set250000": sf.set_cfg_baud(cfg, 250000).hex()}
    b = out["builders"]
    b["returnKey"] = sf.return_key(21, (10, 20, 110, 60), 0x5100, 7).hex()
    b["returnKeyNoUpload"] = sf.return_key(3, (0, 0, 479, 271), 0x1234, 0xbeef,
                                           sound=False, mode=0x12,
                                           upload=False).hex()
    b["dataInput"] = sf.data_input(22, (300, 50, 470, 80), 0x5200).hex()
    b["dataInputNoLimits"] = sf.data_input(22, (1, 2, 3, 4), 0x5202, v_type=0,
                                           n_int=3, n_dot=0,
                                           limits=None).hex()
    b["textVar"] = sf.text_var(0x5110, 12, 34, (10, 30, 150, 60), 20).hex()
    b["baud"] = {str(x): sf.cfg_baud_value(x) for x in
                 (9600, 19200, 38400, 57600, 115200, 250000)}
    path = os.path.join(HERE, "fixtures", "screen_files.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print("wrote", os.path.relpath(path, REPO))


if __name__ == "__main__":
    main()

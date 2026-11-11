#!/bin/bash
# Build an SD-card-ready DWIN_SET (release 1.0.2 + Macros pages + baud CFG)
# into build/sdcard/. Options are passed on, e.g. --baud 115200, --out DIR.
# See: ./make_sdcard.sh --help
set -e
SRCDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${HOME}/dgus-env/bin/python"
[ -x "${PY}" ] || PY=python3
cd "${SRCDIR}"
exec "${PY}" -m dgus_lcd.sdcard "$@"

#!/bin/bash
# Run the test suite on the Pi without risking the board: a hard memory cap
# (the kernel kills the tests, not Klipper), one worker, files in sequence,
# low CPU priority. Extra arguments go to vitest, e.g. a test file.
#   ./scripts/test-pi.sh                 # everything
#   ./scripts/test-pi.sh test/m2.test.ts
#   MEM=350M ./scripts/test-pi.sh
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"
MEM="${MEM:-280M}"
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "MemAvailable ${avail} MB, cap ${MEM}" >&2
if [ "$avail" -lt 300 ]; then
  echo "Less than 300 MB available; stop the dev server (npm run dev) or other jobs first." >&2
  exit 1
fi
exec systemd-run --user --scope -q -p MemoryMax="$MEM" -p MemorySwapMax=0 \
  nice -n 10 env NODE_OPTIONS="--max-old-space-size=160" GOMEMLIMIT=150MiB \
  npx vitest run --maxWorkers=1 --no-file-parallelism "$@"
# Typecheck the same way (tsc 7 is a Go binary: GOMEMLIMIT keeps it small):
#   systemd-run --user --scope -q -p MemoryMax=300M -p MemorySwapMax=0 \
#     env GOMEMLIMIT=150MiB npx tsc --noEmit

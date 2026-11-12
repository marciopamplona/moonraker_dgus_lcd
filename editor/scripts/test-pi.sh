#!/bin/bash
# Run the test suite on the Pi without risking the board: every test file
# runs in its own vitest process inside a memory-capped systemd scope (the
# kernel kills the tests, not Klipper), one worker, low CPU priority.
# Separate processes keep memory flat as the suite grows: one long vitest
# run accumulates results and ran into the cap.
#   ./scripts/test-pi.sh                       # everything
#   ./scripts/test-pi.sh test/m2.test.ts ...   # some files
#   MEM=350M ./scripts/test-pi.sh
#
# Typecheck the same way (tsc 7 is a Go binary: GOMEMLIMIT keeps it small):
#   systemd-run --user --scope -q -p MemoryMax=300M -p MemorySwapMax=0 \
#     env GOMEMLIMIT=150MiB npx tsc --noEmit
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"
MEM="${MEM:-280M}"
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "MemAvailable ${avail} MB, cap ${MEM} per file" >&2
if [ "$avail" -lt 300 ]; then
  echo "Less than 300 MB available; stop the dev server (npm run dev) or other jobs first." >&2
  exit 1
fi

if [ $# -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(ls test/*.test.ts test/*.test.tsx 2>/dev/null | sort)
fi

pass=0 fail=0 failed=()
for f in "${files[@]}"; do
  out=$(systemd-run --user --scope -q -p MemoryMax="$MEM" -p MemorySwapMax=0 \
    nice -n 10 env NODE_OPTIONS="--max-old-space-size=160" GOMEMLIMIT=150MiB \
    npx vitest run --maxWorkers=1 --no-file-parallelism "$f" 2>&1)
  rc=$?
  summary=$(grep -E "^ +Tests " <<<"$out" | tail -1 | sed -E 's/^ +Tests +//')
  if [ $rc -eq 0 ]; then
    pass=$((pass + 1))
    printf "  ok    %-34s %s\n" "$f" "$summary"
  else
    fail=$((fail + 1))
    failed+=("$f")
    if [ $rc -eq 137 ] || [ $rc -eq 143 ] || [ -z "$summary" ]; then
      printf "  KILL  %-34s exit %d (memory cap? see dmesg)\n" "$f" "$rc"
    else
      printf "  FAIL  %-34s %s\n" "$f" "$summary"
    fi
    grep -E "×|FAIL|Error|Expected|Received" <<<"$out" | head -20 | sed 's/^/        /'
  fi
done
echo "Files: $pass passed, $fail failed"
[ $fail -eq 0 ]

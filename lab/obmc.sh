#!/usr/bin/env bash
# A real BMC firmware for Lab 3b: OpenBMC, the open-source BMC firmware stack, on an emulated ASPEED
# AST2500 BMC chip (the Romulus reference board) in QEMU. There is no server behind this BMC: it is the
# BMC alone, to learn its sensors, event log, FRU data, users, firmware inventory and Redfish.
#   ./obmc.sh fetch    download the newest Romulus flash image from OpenBMC's CI (32 MB), keep a clean copy
#   ./obmc.sh run      boot it in this terminal; log in as root / 0penBmc (a zero); Ctrl-a x quits QEMU
#   ./obmc.sh reset    factory reset: replace the working flash image with the clean copy
# From the host: SSH 127.0.0.1:2222, HTTPS (web interface and Redfish) https://127.0.0.1:2443, IPMI 127.0.0.1:2623/udp.
# Needs Fedora's ARM system emulator: sudo dnf install qemu-system-arm
# Steps from https://github.com/openbmc/docs/blob/master/development/dev-environment.md (read 2026-11-20).
set -euo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/rack-lab/obmc"
IMG_URL='https://jenkins.openbmc.org/job/latest-master/label=docker-builder,target=romulus/lastSuccessfulBuild/artifact/openbmc/build/tmp/deploy/images/romulus/obmc-phosphor-image-romulus.static.mtd'
CLEAN="$DATA/romulus-clean.mtd"
WORK="$DATA/romulus.mtd"

case "${1:-}" in
  fetch)
    mkdir -p "$DATA"
    curl -fL --progress-bar -o "$CLEAN.part" "$IMG_URL"
    mv "$CLEAN.part" "$CLEAN"
    cp "$CLEAN" "$WORK"
    date -I > "$DATA/fetched-on"
    ls -lh "$DATA" ;;
  run)
    command -v qemu-system-arm >/dev/null || { echo "missing: sudo dnf install qemu-system-arm" >&2; exit 1; }
    [[ -f $WORK ]] || { echo "run ./obmc.sh fetch first" >&2; exit 1; }
    avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    (( avail >= 1000 )) || { echo "MemAvailable is ${avail} MB; the BMC wants about 1000 MB with headroom" >&2; exit 1; }
    echo "==> booting OpenBMC (several minutes: QEMU emulates the ARM chip in software). Ctrl-a x quits."
    exec qemu-system-arm -m 256 -M romulus-bmc -nographic \
      -drive "file=$WORK,format=raw,if=mtd" \
      -net nic \
      -net user,hostfwd=tcp:127.0.0.1:2222-:22,hostfwd=tcp:127.0.0.1:2443-:443,hostfwd=udp:127.0.0.1:2623-:623,hostname=qemu ;;
  reset)
    [[ -f $CLEAN ]] || { echo "run ./obmc.sh fetch first" >&2; exit 1; }
    cp "$CLEAN" "$WORK"
    echo "==> flash image reset to the clean copy: users, settings and logs are gone" ;;
  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac

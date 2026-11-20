#!/usr/bin/env bash
# Emulated BMCs for the mini rack.
#   ./bmc.sh setup    create the Python venv with virtualbmc and sushy-tools (once)
#   ./bmc.sh start    IPMI on 127.0.0.1 ports 6231-6233 (rk-n1..rk-n3), Redfish on http://127.0.0.1:8000
#   ./bmc.sh stop
#   ./bmc.sh status
#
# Tested on this machine on 2026-11-20 with Python 3.14: virtualbmc 3.4.0 and sushy-tools 2.2.0.
# The venv uses --system-site-packages because the libvirt bindings come from Fedora's python3-libvirt.
set -euo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/rack-lab"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/rack-lab"
VENV="$DATA/venv"
export VIRTUALBMC_CONFIG="$STATE/virtualbmc.conf"
NODES=(rk-n1 rk-n2 rk-n3)
REDFISH_PORT=8000

vbmc() { "$VENV/bin/vbmc" "$@"; }

case "${1:-}" in
  setup)
    mkdir -p "$DATA" "$STATE/vbmc"
    [[ -x $VENV/bin/python ]] || python3 -m venv --system-site-packages "$VENV"
    "$VENV/bin/pip" install --upgrade virtualbmc sushy-tools
    # If vbmc later fails with "No module named 'stevedore'": $VENV/bin/pip install --ignore-installed stevedore
    printf '[default]\nconfig_dir = %s/vbmc\npid_file = %s/vbmcd.pid\nserver_port = 50891\n' "$STATE" "$STATE" > "$VIRTUALBMC_CONFIG"
    "$VENV/bin/vbmc" --version
    echo "==> setup done. Next: ./bmc.sh start"
    ;;
  start)
    [[ -x $VENV/bin/vbmcd ]] || { echo "run ./bmc.sh setup first" >&2; exit 1; }
    if ! { [[ -f $STATE/vbmcd.pid ]] && kill -0 "$(cat "$STATE/vbmcd.pid")" 2>/dev/null; }; then
      "$VENV/bin/vbmcd"             # daemonises and writes $STATE/vbmcd.pid
      sleep 2
    fi
    port=6231
    for n in "${NODES[@]}"; do
      vbmc show "$n" &>/dev/null || vbmc add "$n" --address 127.0.0.1 --port "$port" \
        --username admin --password password --libvirt-uri qemu:///system
      vbmc start "$n" 2>/dev/null || true
      port=$((port + 1))
    done
    if ! { [[ -f $STATE/sushy.pid ]] && kill -0 "$(cat "$STATE/sushy.pid")" 2>/dev/null; }; then
      nohup "$VENV/bin/sushy-emulator" --libvirt-uri qemu:///system -i 127.0.0.1 -p "$REDFISH_PORT" \
        > "$STATE/sushy.log" 2>&1 &
      echo $! > "$STATE/sushy.pid"
      sleep 2
    fi
    vbmc list
    echo "Redfish: http://127.0.0.1:$REDFISH_PORT/redfish/v1 (log: $STATE/sushy.log)"
    ;;
  stop)
    for n in "${NODES[@]}"; do vbmc stop "$n" 2>/dev/null || true; done
    [[ -f $STATE/vbmcd.pid ]] && kill "$(cat "$STATE/vbmcd.pid")" 2>/dev/null || true
    [[ -f $STATE/sushy.pid ]] && kill "$(cat "$STATE/sushy.pid")" 2>/dev/null || true
    rm -f "$STATE/sushy.pid"
    echo "==> BMC emulators stopped"
    ;;
  status)
    vbmc list || true
    printf 'Redfish systems: '
    curl -s "http://127.0.0.1:$REDFISH_PORT/redfish/v1/Systems" | jq '."Members@odata.count"' 2>/dev/null || echo "not running"
    ;;
  *)
    echo "usage: $0 {setup|start|stop|status}" >&2; exit 1 ;;
esac

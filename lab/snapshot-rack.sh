#!/usr/bin/env bash
# Snapshot or revert the three rack nodes as one unit.
#   ./snapshot-rack.sh save <name>     e.g. save clean, save bonded
#   ./snapshot-rack.sh revert <name>
#   ./snapshot-rack.sh list
#   ./snapshot-rack.sh delete <name>
set -euo pipefail

VIRSH="virsh -c qemu:///system"
NODES=(rk-n1 rk-n2 rk-n3)

usage() { echo "usage: $0 {save|revert|list|delete} [name]" >&2; exit 1; }
[[ $# -ge 1 ]] || usage
ACTION=$1
NAME="${2:-}"

case "$ACTION" in
  save)
    [[ -n $NAME ]] || usage
    for n in "${NODES[@]}"; do
      echo "==> snapshot $n -> $NAME"
      $VIRSH snapshot-create-as --domain "$n" --name "$NAME" --atomic
    done
    ;;
  revert)
    [[ -n $NAME ]] || usage
    for n in "${NODES[@]}"; do
      echo "==> revert $n -> $NAME"
      $VIRSH snapshot-revert --domain "$n" --snapshotname "$NAME" --running
    done
    # A revert restores the saved memory, so the guest clocks jump back. Step them forward.
    sleep 5
    for n in "${NODES[@]}"; do
      ssh "$n" 'sudo chronyc makestep' &>/dev/null || true
    done
    echo "==> reverted, clocks stepped"
    ;;
  list)
    for n in "${NODES[@]}"; do echo "== $n"; $VIRSH snapshot-list --domain "$n"; done
    ;;
  delete)
    [[ -n $NAME ]] || usage
    for n in "${NODES[@]}"; do $VIRSH snapshot-delete --domain "$n" --snapshotname "$NAME"; done
    ;;
  *) usage ;;
esac

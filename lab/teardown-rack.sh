#!/usr/bin/env bash
# Remove the mini rack: the nodes, the PXE test VM, their disks and the two rack networks.
# The Ubuntu base image (noble-base.qcow2) stays, so a rebuild does not download it again.
set -euo pipefail

VIRSH="virsh -c qemu:///system"

read -r -p "Delete rk-n1, rk-n2, rk-n3, rk-pxe, their disks and snapshots, and the rack networks? [y/N] " answer
[[ $answer == y ]] || exit 0

"$(dirname "$0")/bmc.sh" stop 2>/dev/null || true

# Stop any flaky-link loop of faults.sh before its node disappears, and forget injected faults.
ST="${XDG_STATE_HOME:-$HOME/.local/state}/rack-lab"
for p in "$ST"/flaky-*.pid; do
  [[ -f $p ]] || continue
  kill "$(<"$p")" 2>/dev/null || true
  rm -f "$p"
done
rm -f "$ST/active" "$ST"/bios-*.prev

for n in rk-n1 rk-n2 rk-n3 rk-pxe; do
  $VIRSH dominfo "$n" &>/dev/null || continue
  echo "==> removing $n"
  $VIRSH destroy "$n" &>/dev/null || true
  $VIRSH undefine "$n" --snapshots-metadata --remove-all-storage || true
done
sudo rm -f /var/lib/libvirt/images/rk-n?.qcow2 /var/lib/libvirt/images/rk-n?-data.qcow2 /var/lib/libvirt/images/rk-n?-seed.iso

for net in rack-data rack-backend; do
  $VIRSH net-info "$net" &>/dev/null || continue
  echo "==> removing network $net"
  $VIRSH net-destroy "$net" &>/dev/null || true
  $VIRSH net-undefine "$net"
done
echo "==> done"

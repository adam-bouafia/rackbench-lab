#!/usr/bin/env bash
# Firmware tool for the mini rack: a stand-in for a vendor update tool such as Supermicro Update Manager (SUM).
# SUM reads and flashes BIOS and BMC firmware out of band, through each server's BMC, for a whole rack.
# Here the "BIOS" is the SMBIOS identity in each VM's definition (what dmidecode shows inside the node),
# and a flash is: write the new version, then a cold boot (power off, power on). A real BIOS update also
# only takes effect after the server restarts.
#   ./fw.sh releases                 the BIOS files you have: version and release date
#   ./fw.sh list                     BIOS vendor, version and date of every node
#   ./fw.sh get <node>               the BIOS version of one node
#   ./fw.sh update <node> <version>  flash one node, then cold-boot it
set -euo pipefail

VIRSH="virsh -c qemu:///system"
NODES=(rk-n1 rk-n2 rk-n3)
RELEASES=("1.2 03/02/2026" "1.3 06/15/2026" "1.4 10/01/2026" "1.5 11/12/2026")

usage() { sed -n '7,10p' "$0" >&2; exit 1; }
field() { $VIRSH dumpxml "$1" --xpath "//sysinfo/bios/entry[@name='$2']/text()"; }
date_of() { local r; for r in "${RELEASES[@]}"; do [[ ${r%% *} == "$1" ]] && { echo "${r#* }"; return 0; }; done; return 1; }

coldboot() {
  local n=$1
  if [[ $($VIRSH domstate "$n") == running ]]; then
    $VIRSH shutdown "$n" >/dev/null
    for _ in $(seq 60); do [[ $($VIRSH domstate "$n") == "shut off" ]] && break; sleep 1; done
    [[ $($VIRSH domstate "$n") == "shut off" ]] || $VIRSH destroy "$n" >/dev/null
  fi
  $VIRSH start "$n" >/dev/null
}

case "${1:-}" in
  releases)
    printf '%s\n' "${RELEASES[@]}" ;;
  list)
    printf '%-6s %-8s %-8s %s\n' NODE VENDOR VERSION DATE
    for n in "${NODES[@]}"; do
      printf '%-6s %-8s %-8s %s\n' "$n" "$(field "$n" vendor)" "$(field "$n" version)" "$(field "$n" date)"
    done ;;
  get)
    [[ $# -eq 2 ]] || usage
    field "$2" version ;;
  update)
    [[ $# -eq 3 ]] || usage
    n=$2 v=$3
    d=$(date_of "$v") || { echo "no BIOS file for version $v (see ./fw.sh releases)" >&2; exit 1; }
    echo "==> $n: BIOS $(field "$n" version) -> $v, then a cold boot"
    virt-xml --connect qemu:///system "$n" --edit --sysinfo "bios.version=$v,bios.date=$d" >/dev/null
    coldboot "$n"
    echo "==> $n is starting. Verify from the OS once SSH answers: sudo dmidecode -s bios-version" ;;
  *) usage ;;
esac

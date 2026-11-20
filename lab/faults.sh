#!/usr/bin/env bash
# Fault injector for the mini rack (Lab 8). It plays the bad part, the bad cable and the broken BMC.
#   ./faults.sh random                 one random fault on a random node; the answer stays hidden
#   ./faults.sh list                   the faults by name
#   ./faults.sh inject <fault> <node>  one named fault, e.g. ./faults.sh inject slow-data-disk rk-n2
#   ./faults.sh reveal                 show what was injected
#   ./faults.sh clear                  undo every fault this script injected
set -euo pipefail

LAB=$(cd "$(dirname "$0")" && pwd)
VIRSH="virsh -c qemu:///system"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/rack-lab"
ACTIVE="$STATE/active"
VBMC="${XDG_DATA_HOME:-$HOME/.local/share}/rack-lab/venv/bin/vbmc"
export VIRTUALBMC_CONFIG="$STATE/virtualbmc.conf"
NODES=(rk-n1 rk-n2 rk-n3)
FAULTS=(data-disk-missing slow-data-disk backend-link-down slow-backend memory-missing mgmt-link-down bmc-down
        cpu-throttle flaky-link bios-drift)
BOND_ONLY=(mtu-mismatch)                                                 # only after Lab 5, when bond0 exists
mkdir -p "$STATE"

octet() { echo $((10 + ${1#rk-n})); }                                   # rk-n2 -> 12
mac() { printf '52:54:00:70:%02d:%s' "$1" "$(octet "$2")"; }            # mac <nic 0|1|2> <node>
has_bond() { ssh -n -o ConnectTimeout=5 "$1" 'ip link show bond0' &>/dev/null; }

apply() {   # apply <fault> <node> <on|off>
  local f=$1 n=$2 mode=$3
  case "$f" in
    data-disk-missing)
      if [[ $mode == on ]]; then $VIRSH detach-disk "$n" vdb --live
      else $VIRSH attach-disk "$n" "/var/lib/libvirt/images/$n-data.qcow2" vdb --live \
             --driver qemu --subdriver qcow2 --targetbus virtio --serial "RK$(octet "$n")-DATA"; fi ;;
    slow-data-disk)
      $VIRSH blkdeviotune "$n" vdb --live --total-iops-sec "$([[ $mode == on ]] && echo 150 || echo 0)" ;;
    backend-link-down)
      $VIRSH domif-setlink "$n" "$(mac 1 "$n")" "$([[ $mode == on ]] && echo down || echo up)" ;;
    slow-backend)
      for nic in 1 2; do
        $VIRSH domiftune "$n" "$(mac "$nic" "$n")" --live \
          --inbound "$([[ $mode == on ]] && echo 2048 || echo 0)" --outbound "$([[ $mode == on ]] && echo 2048 || echo 0)"
      done ;;
    memory-missing)
      local max; max=$($VIRSH dominfo "$n" | awk '/Max memory/ {print $3}')
      $VIRSH setmem "$n" "$([[ $mode == on ]] && echo 1048576 || echo "$max")" --live ;;
    mgmt-link-down)
      $VIRSH domif-setlink "$n" "$(mac 0 "$n")" "$([[ $mode == on ]] && echo down || echo up)" ;;
    bmc-down)
      "$VBMC" "$([[ $mode == on ]] && echo stop || echo start)" "$n" ;;
    cpu-throttle)
      # Each vCPU gets 40% of a host core: the node works, but slower than its neighbours under load.
      # On a real server: thermal throttling (a dead fan, blocked airflow) or a power-capping BIOS setting.
      $VIRSH schedinfo "$n" --live --set vcpu_quota="$([[ $mode == on ]] && echo 40000 || echo -1)" >/dev/null ;;
    flaky-link)
      # An intermittent cable: be0 drops for 2 seconds every 25 seconds. Most tests still pass.
      local pidf="$STATE/flaky-$n.pid" m; m=$(mac 1 "$n")
      if [[ $mode == on ]]; then
        nohup bash -c "trap 'exit 0' TERM
          while :; do
            $VIRSH domif-setlink $n $m down >/dev/null; sleep 2 & wait \$!
            $VIRSH domif-setlink $n $m up >/dev/null; sleep 25 & wait \$!
          done" </dev/null >/dev/null 2>&1 &
        echo $! > "$pidf"
      else
        if [[ -f $pidf ]]; then
          local pid; pid=$(<"$pidf")
          kill "$pid" 2>/dev/null || true
          for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
          rm -f "$pidf"
        fi
        $VIRSH domif-setlink "$n" "$m" up >/dev/null
      fi ;;
    bios-drift)
      # One node runs an older BIOS than the BOM asks for. Flashing it cold-boots the node (see fw.sh).
      local prev="$STATE/bios-$n.prev"
      if [[ $mode == on ]]; then
        local cur old; cur=$("$LAB/fw.sh" get "$n")
        old=$("$LAB/fw.sh" releases | awk -v c="$cur" '$1 == c {print p; exit} {p = $1}')
        [[ -n $old ]] || old=$("$LAB/fw.sh" releases | awk -v c="$cur" '$1 != c {print $1; exit}')
        echo "$cur" > "$prev"
        "$LAB/fw.sh" update "$n" "$old" >/dev/null
      else
        "$LAB/fw.sh" update "$n" "$(<"$prev")" >/dev/null && rm -f "$prev"
      fi ;;
    mtu-mismatch)
      # Lowering bond0 also lowers bond0.10, but raising bond0 does not raise the VLAN again: set both.
      local mtu; mtu=$([[ $mode == on ]] && echo 1500 || echo 9000)
      ssh -n "$n" "sudo ip link set bond0 mtu $mtu && { ! ip link show bond0.10 >/dev/null 2>&1 || sudo ip link set bond0.10 mtu $mtu; }" ;;
    *) echo "unknown fault: $f" >&2; exit 1 ;;
  esac
}

case "${1:-}" in
  list)
    printf '%s\n' "${FAULTS[@]}"
    printf '%s (only after Lab 5, when bond0 exists)\n' "${BOND_ONLY[@]}" ;;
  inject)
    [[ $# -eq 3 ]] || { echo "usage: $0 inject <fault> <node>" >&2; exit 1; }
    apply "$2" "$3" on
    echo "$2 $3" >> "$ACTIVE"
    echo "==> injected $2 on $3" ;;
  random)
    pool=("${FAULTS[@]}")
    has_bond rk-n1 && pool+=("${BOND_ONLY[@]}")
    f=${pool[RANDOM % ${#pool[@]}]}
    n=${NODES[RANDOM % ${#NODES[@]}]}
    apply "$f" "$n" on >/dev/null
    echo "$f $n" >> "$ACTIVE"
    echo "==> one fault injected somewhere in the rack. Find it, write it down, then: ./faults.sh reveal" ;;
  reveal)
    [[ -s $ACTIVE ]] && cat "$ACTIVE" || echo "no faults injected" ;;
  clear)
    [[ -s $ACTIVE ]] || { echo "no faults injected"; exit 0; }
    tac "$ACTIVE" | while read -r f n; do
      echo "==> clearing $f on $n"
      apply "$f" "$n" off </dev/null || echo "    could not clear $f on $n: check by hand" >&2
    done
    rm -f "$ACTIVE" ;;
  *)
    sed -n '2,8p' "$0"; exit 1 ;;
esac

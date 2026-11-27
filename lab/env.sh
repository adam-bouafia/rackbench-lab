# shellcheck shell=bash
# Shell helpers for the mini rack. Load them in each terminal with:  source lab/env.sh
# Type the full commands yourself first (Lab 3). Use these shortcuts once you know what they hide.

export LIBVIRT_DEFAULT_URI=qemu:///system                            # plain `virsh` talks to the lab VMs
export VIRTUALBMC_CONFIG="${XDG_STATE_HOME:-$HOME/.local/state}/rack-lab/virtualbmc.conf"
RACKLAB_VENV="${XDG_DATA_HOME:-$HOME/.local/share}/rack-lab/venv"
vbmc() { "$RACKLAB_VENV/bin/vbmc" "$@"; }                         # the venv stays off your PATH
export RF=http://127.0.0.1:8000/redfish/v1
RACK=(rk-n1 rk-n2 rk-n3)

# bmc <node> <ipmitool args...>    e.g. bmc rk-n2 power status
# -C 3: the emulator speaks the older SHA1 cipher suite; newer real BMCs prefer suite 17.
bmc() { local node=$1; shift; ipmitool -I lanplus -C 3 -H 127.0.0.1 -p $((6230 + ${node#rk-n})) -U admin -P password "$@"; }

# rf <path>                         e.g. rf Systems    (follows the 307 redirect from name to UUID)
rf() { curl -sL "$RF/$1" | jq .; }

# rfsys <node> [subpath]            e.g. rfsys rk-n1 EthernetInterfaces
rfsys() { curl -sL "$RF/Systems/$(virsh domuuid "$1")${2:+/$2}" | jq .; }

# rfpower <node> <On|ForceOff|GracefulShutdown|GracefulRestart|ForceRestart>
rfpower() {
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d "{\"ResetType\":\"$2\"}" "$RF/Systems/$(virsh domuuid "$1")/Actions/ComputerSystem.Reset"
}

# rfboot <node> <Pxe|Hdd|Cd>        boot override for the next boot only
rfboot() {
  curl -s -o /dev/null -w '%{http_code}\n' -X PATCH -H 'Content-Type: application/json' \
    -d "{\"Boot\":{\"BootSourceOverrideTarget\":\"$2\",\"BootSourceOverrideEnabled\":\"Once\"}}" \
    "$RF/Systems/$(virsh domuuid "$1")"
}

# onall <command>                   run a command on every node over SSH, output prefixed by node
onall() { for n in "${RACK[@]}"; do ssh "$n" "$@" 2>&1 | sed "s/^/[$n] /"; done; }

# The OpenBMC BMC of Lab 3b (./obmc.sh run). Real firmware: cipher suite 17 (SHA256), and Redfish wants a login.
# obmc <ipmitool args...>           e.g. obmc sdr elist
obmc() { ipmitool -I lanplus -C 17 -H 127.0.0.1 -p 2623 -U root -P 0penBmc "$@"; }
# orf [path]                        e.g. orf Managers    (-k: the BMC has a self-signed certificate)
orf() { curl -sk -u root:0penBmc "https://127.0.0.1:2443/redfish/v1/${1:-}" | jq .; }

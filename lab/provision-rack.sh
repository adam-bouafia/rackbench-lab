#!/usr/bin/env bash
# Build the mini rack: three Ubuntu 24.04 nodes on libvirt/KVM.
#
#   rack-data     192.168.70.0/24, NAT, DHCP reservations. NIC mgmt0 of every node (SSH, apt, PXE).
#   rack-backend  isolated layer 2, MTU 9000, no DHCP. NICs be0 and be1 of every node (bond, VLAN, iperf3).
#
# Each node looks like a small two-socket server: 2 sockets with 1 vCPU each and 2 NUMA nodes (768 MB each,
# 1536 MB in all); an SMBIOS identity as dmidecode shows it (manufacturer, product, board, serial numbers,
# BIOS version 1.4); an OS disk vda (10 GB) and an empty data disk vdb (4 GB) for fio, both with serials.
# Uses sudo for the disk images in /var/lib/libvirt/images. Safe to run twice.
set -euo pipefail

VIRSH="virsh -c qemu:///system"
POOL_DIR=/var/lib/libvirt/images
BASE="$POOL_DIR/noble-base.qcow2"            # downloaded once, reused if present
IMG_URL=https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
PUBKEY_FILE="$HOME/.ssh/id_ed25519.pub"
MEM=${MEM:-1536}                              # MB, split evenly over the two NUMA nodes
BIOS_VERSION=1.4                              # the golden BIOS in bom.yaml; ./fw.sh changes it later
BIOS_DATE=10/01/2026
NODES=(rk-n1:11 rk-n2:12 rk-n3:13)
# Test tools installed in every node by cloud-init
PKGS="stress-ng fio iperf3 memtester lshw pciutils dmidecode numactl nvme-cli smartmontools sysstat ethtool jq chrony"
PKGS_YAML=${PKGS// /, }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

[[ -f $PUBKEY_FILE ]] || { echo "No $PUBKEY_FILE: create one with ssh-keygen -t ed25519" >&2; exit 1; }
PUBKEY=$(<"$PUBKEY_FILE")
command -v xorriso >/dev/null || { echo "xorriso is missing: sudo dnf install xorriso" >&2; exit 1; }

# --- memory guard: three nodes plus headroom for the desktop ------------------
missing=0
for n in "${NODES[@]}"; do $VIRSH dominfo "${n%%:*}" &>/dev/null || missing=$((missing + 1)); done
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
need=$(( missing * MEM + 3000 ))
if (( missing > 0 && avail < need )); then
  echo "MemAvailable is ${avail} MB; building ${missing} node(s) needs ${need} MB (nodes plus 3 GB for the desktop)." >&2
  echo "Close programs to free memory, or build smaller nodes with MEM=1024 ./provision-rack.sh" >&2
  exit 1
fi

mac() { printf '52:54:00:70:%02d:%s' "$1" "$2"; }   # mac <nic 0|1|2> <last octet of the node>

# --- networks ---------------------------------------------------------------
if ! $VIRSH net-info rack-data &>/dev/null; then
  echo "==> Network rack-data (192.168.70.0/24, NAT)"
  {
    echo "<network><name>rack-data</name><forward mode='nat'/>"
    echo "<bridge name='virbr-rkdata' stp='on' delay='0'/>"
    echo "<ip address='192.168.70.1' netmask='255.255.255.0'><dhcp>"
    echo "<range start='192.168.70.100' end='192.168.70.199'/>"
    for n in "${NODES[@]}"; do
      IFS=: read -r name oct <<<"$n"
      echo "<host mac='$(mac 0 "$oct")' name='$name' ip='192.168.70.$oct'/>"
    done
    # Only used when a machine boots from the network (Lab 6): iPXE fetches this URL.
    echo "<bootp file='http://192.168.70.1:8080/boot.ipxe'/>"
    echo "</dhcp></ip></network>"
  } > "$WORK/rack-data.xml"
  $VIRSH net-define "$WORK/rack-data.xml"
  $VIRSH net-start rack-data
  $VIRSH net-autostart rack-data
fi

if ! $VIRSH net-info rack-backend &>/dev/null; then
  echo "==> Network rack-backend (isolated, MTU 9000)"
  cat > "$WORK/rack-backend.xml" <<'EOF'
<network>
  <name>rack-backend</name>
  <bridge name='virbr-rkback' stp='off' delay='0'/>
  <mtu size='9000'/>
</network>
EOF
  $VIRSH net-define "$WORK/rack-backend.xml"
  $VIRSH net-start rack-backend
  $VIRSH net-autostart rack-backend
fi

# --- base image ---------------------------------------------------------------
if ! sudo test -f "$BASE"; then
  echo "==> Downloading the Ubuntu 24.04 cloud image (about 600 MB)"
  sudo curl -fL --progress-bar -o "$BASE" "$IMG_URL"
fi

# --- nodes ----------------------------------------------------------------------
for n in "${NODES[@]}"; do
  IFS=: read -r NAME OCT <<<"$n"
  if $VIRSH dominfo "$NAME" &>/dev/null; then
    echo "==> $NAME exists, skipping"
    continue
  fi
  DISK="$POOL_DIR/$NAME.qcow2"
  DATA="$POOL_DIR/$NAME-data.qcow2"
  SEED="$POOL_DIR/$NAME-seed.iso"

  echo "==> Disks for $NAME"
  sudo qemu-img convert -O qcow2 "$BASE" "$DISK"
  sudo qemu-img resize -q "$DISK" 10G
  sudo qemu-img create -q -f qcow2 "$DATA" 4G

  mkdir -p "$WORK/$NAME"
  cat > "$WORK/$NAME/user-data" <<EOF
#cloud-config
hostname: $NAME
manage_etc_hosts: true
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $PUBKEY
ssh_pwauth: false
# The NAT network has no IPv6, and the network can still be settling when cloud-init starts:
# use IPv4, retry, and only report "provisioned" when the test tools are really installed.
apt:
  conf: |
    Acquire::ForceIPv4 "true";
    Acquire::Retries "5";
package_update: true
packages: [$PKGS_YAML]
runcmd:
  - [sh, -c, 'for i in 1 2 3 4 5 6; do command -v fio && command -v stress-ng && command -v iperf3 && command -v memtester && break; sleep 20; apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q $PKGS; done >/dev/null 2>&1']
  - [sh, -c, 'if command -v fio && command -v stress-ng && command -v iperf3 && command -v memtester; then touch /root/.provisioned; else touch /root/.provision-failed; fi >/dev/null']
EOF
  printf 'instance-id: %s\nlocal-hostname: %s\n' "$NAME" "$NAME" > "$WORK/$NAME/meta-data"
  # Stable NIC names from the MAC address: mgmt0, be0, be1 (real servers do the same with udev or netplan).
  cat > "$WORK/$NAME/network-config" <<EOF
network:
  version: 2
  ethernets:
    mgmt0:
      match: {macaddress: "$(mac 0 "$OCT")"}
      set-name: mgmt0
      dhcp4: true
    be0:
      match: {macaddress: "$(mac 1 "$OCT")"}
      set-name: be0
      dhcp4: false
    be1:
      match: {macaddress: "$(mac 2 "$OCT")"}
      set-name: be1
      dhcp4: false
EOF
  (cd "$WORK/$NAME" && xorriso -as mkisofs -quiet -o "$WORK/$NAME-seed.iso" -V cidata -J -r user-data meta-data network-config)
  sudo install -m 0644 "$WORK/$NAME-seed.iso" "$SEED"

  HALF=$(( MEM * 1024 / 2 ))                  # KiB per NUMA node
  SERIAL="RL2611-0$OCT"
  echo "==> Installing $NAME (192.168.70.$OCT, serial $SERIAL, 2 sockets, ${MEM} MB)"
  sudo virt-install --connect qemu:///system \
    --name "$NAME" --memory "$MEM" \
    --vcpus 2,sockets=2,cores=1,threads=1 \
    --cpu "host-passthrough,cell0.id=0,cell0.cpus=0,cell0.memory=$HALF,cell1.id=1,cell1.cpus=1,cell1.memory=$HALF" \
    --sysinfo "bios.vendor=RackLab,bios.version=$BIOS_VERSION,bios.date=$BIOS_DATE,system.manufacturer=RackLab,system.product=RL-2S-1U,system.version=A1,system.serial=$SERIAL,system.family=RL-2S,baseBoard.manufacturer=RackLab,baseBoard.product=RLB-2S,baseBoard.version=1.02,baseBoard.serial=RLB2611-0$OCT,chassis.manufacturer=RackLab,chassis.serial=RLC2611-0$OCT" \
    --disk "path=$DISK,format=qcow2,bus=virtio,serial=RK$OCT-OS" \
    --disk "path=$DATA,format=qcow2,bus=virtio,serial=RK$OCT-DATA" \
    --disk "path=$SEED,device=cdrom" \
    --network "network=rack-data,mac=$(mac 0 "$OCT"),model=virtio" \
    --network "network=rack-backend,mac=$(mac 1 "$OCT"),model=virtio" \
    --network "network=rack-backend,mac=$(mac 2 "$OCT"),model=virtio" \
    --os-variant ubuntu24.04 --graphics none --noautoconsole --import
done

cat <<'EOF'

==> Rack defined. cloud-init installs the test tools in each node (about 4 minutes).

Wait until all three are ready:
  for h in rk-n1 rk-n2 rk-n3; do
    until ssh "$h" 'sudo test -f /root/.provisioned -o -f /root/.provision-failed' 2>/dev/null; do sleep 10; done
    ssh "$h" 'sudo test -f /root/.provisioned' && echo "$h ready" || echo "$h FAILED: ssh $h sudo tail -50 /var/log/cloud-init-output.log"
  done

Then take the clean snapshot:
  ./snapshot-rack.sh save clean
EOF

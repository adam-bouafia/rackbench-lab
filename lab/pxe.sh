#!/usr/bin/env bash
# Network boot for the mini rack (Lab 6). Alpine Linux boots into RAM over HTTP through iPXE.
#   ./pxe.sh fetch    download the Alpine netboot files and write boot.ipxe
#   ./pxe.sh serve    serve them on http://192.168.70.1:8080 (stays in the foreground; Ctrl-C stops it)
#   ./pxe.sh vm       create rk-pxe, a diskless VM that boots from the network, and attach its console
#   ./pxe.sh rm       remove rk-pxe
#
# The rack-data network already hands out http://192.168.70.1:8080/boot.ipxe as the boot file.
# Fedora's firewall blocks port 8080 from the VMs until you open it (runtime only, gone after a reboot):
#   sudo firewall-cmd --zone=libvirt --add-port=8080/tcp
set -euo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/rack-lab/pxe"
ALPINE=https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/netboot
REPO=http://dl-cdn.alpinelinux.org/alpine/latest-stable/main
HOST=192.168.70.1
PORT=8080
VIRSH="virsh -c qemu:///system"

case "${1:-}" in
  fetch)
    mkdir -p "$DATA"
    for f in vmlinuz-lts initramfs-lts modloop-lts; do
      echo "==> $f"
      curl -fL --progress-bar -o "$DATA/$f" "$ALPINE/$f"
    done
    cat > "$DATA/boot.ipxe" <<EOF
#!ipxe
echo Rack lab: booting Alpine Linux from http://$HOST:$PORT
kernel http://$HOST:$PORT/vmlinuz-lts ip=dhcp alpine_repo=$REPO modloop=http://$HOST:$PORT/modloop-lts console=tty0 console=ttyS0,115200
initrd http://$HOST:$PORT/initramfs-lts
boot
EOF
    ls -lh "$DATA"
    ;;
  serve)
    [[ -f $DATA/boot.ipxe ]] || { echo "run ./pxe.sh fetch first" >&2; exit 1; }
    echo "==> serving $DATA on http://$HOST:$PORT (is port 8080 open in the libvirt firewall zone?)"
    exec python3 -m http.server "$PORT" --bind "$HOST" --directory "$DATA"
    ;;
  vm)
    if ! $VIRSH dominfo rk-pxe &>/dev/null; then
      virt-install --connect qemu:///system --name rk-pxe --memory 1024 --vcpus 1 \
        --pxe --disk none --network network=rack-data,model=virtio \
        --osinfo linux2022 --graphics none --noautoconsole
    fi
    echo "==> console of rk-pxe (Ctrl-] leaves it). Log in as root, no password."
    exec $VIRSH console rk-pxe
    ;;
  rm)
    $VIRSH destroy rk-pxe &>/dev/null || true
    $VIRSH undefine rk-pxe && echo "==> rk-pxe removed"
    ;;
  *)
    echo "usage: $0 {fetch|serve|vm|rm}" >&2; exit 1 ;;
esac

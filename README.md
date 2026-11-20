# rackbench

A small server rack on a laptop, for learning how racks are tested before they ship, and an interactive website that explains every part of it.

- `lab/`: scripts that build a three-node rack on KVM and libvirt. The nodes look like two-socket servers (serial numbers, a BIOS version, two NUMA nodes); emulated BMCs answer IPMI and Redfish; OpenBMC runs in QEMU as a real BMC firmware; an iPXE server boots machines from the network; a firmware tool plays a vendor update tool; a fault injector plays the bad disk, the bad cable and the dead BMC.
- `site/`: Rackbench Explorer, a React site with step-through lessons (IPMI, Redfish, PXE, the event log, BIOS updates), interactive parts (rack tour, DIMM population, BOM check, outliers, jumbo frames, bond failover) and a fault-hunt game.

The workflow is the real one; the numbers are not. Not affiliated with any hardware vendor.

## Requirements

- Linux with KVM and libvirt (written and tested on Fedora), your user in the `libvirt` group
- About 7.5 GB of free memory for three nodes and the desktop
- `virt-install`, `qemu-img`, `xorriso`, `jq`, `ipmitool`; `qemu-system-arm` for OpenBMC; Python 3 for the BMC emulators (installed in a venv)
- Node.js 24 for the site

## Lab quick start

```bash
cd lab
./provision-rack.sh                 # networks rack-data and rack-backend, nodes rk-n1..rk-n3
./snapshot-rack.sh save clean       # ./snapshot-rack.sh revert clean undoes anything
./bmc.sh setup && ./bmc.sh start    # IPMI on 127.0.0.1:6231-6233, Redfish on 127.0.0.1:8000
source env.sh                       # shortcuts: bmc, rf, rfsys, rfpower, rfboot, onall, obmc, orf
bmc rk-n1 power status
./fw.sh list
./faults.sh random                  # find it, then ./faults.sh reveal and ./faults.sh clear
```

| Script | What it does |
|---|---|
| `provision-rack.sh` | builds the two networks and the three nodes (cloud-init installs the test tools) |
| `snapshot-rack.sh` | saves, reverts, lists and deletes snapshots of all three nodes at once |
| `teardown-rack.sh` | removes the nodes, their disks and the rack networks |
| `bmc.sh` | virtualbmc (IPMI) and sushy-tools (Redfish) for the nodes |
| `obmc.sh` | OpenBMC (Romulus image) in QEMU: real SEL, FRU, sensors and Redfish sessions |
| `fw.sh` | lists and "flashes" node BIOS versions, then cold-boots the node |
| `pxe.sh` | Alpine netboot files, an HTTP boot server and a diskless test VM |
| `faults.sh` | injects, reveals and clears faults, alone or at random |
| `env.sh` | shell shortcuts for the commands above |
| `bom.yaml` | the golden configuration and asset list the nodes are checked against |

Faults: `data-disk-missing`, `slow-data-disk`, `backend-link-down`, `slow-backend`, `memory-missing`, `mgmt-link-down`, `bmc-down`, `cpu-throttle`, `flaky-link`, `bios-drift`, and `mtu-mismatch` once the bond exists.

Safety: stress tests and fio run inside the nodes only, and fio writes only to the data disk `/dev/vdb`.

## The site

```bash
cd site
npm install
npm run dev          # http://localhost:5173
npm run build        # static files in site/dist
```

The site is static and works on any host. Two optional features use outside services; their keys live in `site/.env.local` or in the hosting provider's settings, never in git (`.gitignore` excludes every `.env` file):

- Ask the rack: a question box that sends the current lesson and step to a model through the Vercel AI Gateway. It needs the function in `site/api/ask.ts`, so it works on Vercel and with `npm run dev`. Set `AI_GATEWAY_API_KEY` and build with `VITE_ASSISTANT=1`. The function limits question length, answer length and requests per visitor; also set a spend limit in the Vercel dashboard.
- Narration: `node scripts/narrate.ts` counts the characters of every lesson step and estimates the ElevenLabs credits; with `--yes` and `ELEVENLABS_API_KEY` set it writes MP3 files and a manifest to `site/public/audio/`. The site then offers a narration switch. The audio files are plain static files.

See `site/.env.example` for the variables.

## Deploying

- Vercel: import the repository, set the root directory to `site`, add the environment variables above. `site/vercel.json` holds the build settings.
- GitHub Pages: the workflow `.github/workflows/pages.yml` builds the static site without the assistant. It only runs when started by hand from the Actions tab.

## Layout

```
lab/                 the rack scripts and bom.yaml
site/src/engine/     the step-through player: map view, sequence view, message list, inspector
site/src/lessons/    lesson list and the step-through lesson content
site/src/widgets/    the interactive lessons
site/src/hunt/       the fault-hunt simulator and its terminal
site/src/pages/      home and lab pages
site/api/ask.ts      the assistant function
site/scripts/        the narration script
```

## License

MIT, see `LICENSE`.

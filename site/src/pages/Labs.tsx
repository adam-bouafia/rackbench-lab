import { CodeBlock } from '../engine/ui'
import { lessonById } from '../lessons/index'
import { SITE, labFile } from '../site'

interface Lab {
  id: string
  title: string
  goal: string
  code: string
  done: string
  lessons?: string[]
}

const SETUP = `# Fedora (or any Linux with KVM and libvirt); you need about 7.5 GB of free memory
sudo dnf install virt-install qemu-img xorriso jq ipmitool lshw qemu-system-arm
git clone ${SITE.repo}.git && cd rackbench/lab
./provision-rack.sh            # three Ubuntu nodes, two networks; asks sudo for the disk images
./snapshot-rack.sh save clean  # undo anything later with: ./snapshot-rack.sh revert clean
./bmc.sh setup && ./bmc.sh start   # emulated BMCs: IPMI on 127.0.0.1:6231-6233, Redfish on :8000
source env.sh                  # shortcuts: bmc, rf, rfsys, rfpower, rfboot, onall, obmc, orf`

const LABS: Lab[] = [
  {
    id: '0',
    title: 'Rules and baseline',
    goal: 'Keep the workstation alive while the rack works hard.',
    code: `free -m          # write down MemAvailable
# stress tests and fio run inside the nodes only, never on the host
# fio writes only to /dev/vdb, never to vda
# before anything risky:  ./snapshot-rack.sh save <name>`,
    done: 'You can name the rules without looking.',
  },
  {
    id: '1',
    title: 'The rack',
    goal: 'Know every network and every cable, the way you read a rack diagram.',
    code: `virsh net-list
virsh net-dumpxml rack-data
for n in rk-n1 rk-n2 rk-n3; do virsh domiflist $n; virsh domblklist $n; done
onall 'ip -br link; ip -br addr'`,
    done: 'You can point at any MAC and say which node, port and network it is, and you wrote the cabling table yourself.',
    lessons: ['rack-tour'],
  },
  {
    id: '2',
    title: 'Know your node',
    goal: 'Read a server\'s hardware from Linux and check it against the bill of materials (lab/bom.yaml).',
    code: `ssh rk-n1 'lscpu; numactl --hardware; free -m'
ssh rk-n1 'sudo dmidecode -t system -t baseboard -t bios -t memory'
ssh rk-n1 'lsblk -o NAME,SIZE,MODEL,SERIAL; ip -j link | jq'
./faults.sh inject memory-missing rk-n2   # the board says one size, the OS sees less
./faults.sh clear`,
    done: 'The inventory of all three nodes is in JSON and checked against bom.yaml.',
    lessons: ['server-anatomy', 'bom-check'],
  },
  {
    id: '3',
    title: 'The BMC: IPMI, Redfish, console, firmware',
    goal: 'Control a server you cannot touch: power, boot device, inventory, console, BIOS version.',
    code: `ipmitool -I lanplus -C 3 -H 127.0.0.1 -p 6231 -U admin -P password power status
bmc rk-n1 chassis bootdev pxe && bmc rk-n1 chassis bootparam get 5
curl -s http://127.0.0.1:8000/redfish/v1/Systems | jq .
rfsys rk-n1 && rfpower rk-n1 ForceRestart
virsh console rk-n1                       # the stand-in for serial over LAN
./fw.sh list && ./fw.sh update rk-n1 1.5  # one node first, verify, then the rest
./faults.sh inject bmc-down rk-n3         # a dead BMC is not a dead server`,
    done: 'Power, boot override and inventory over IPMI and Redfish without notes, and a rack BIOS update done one node at a time.',
    lessons: ['ipmi-power', 'ipmi-boot', 'redfish', 'bios-update'],
  },
  {
    id: '3b',
    title: 'A real BMC firmware (OpenBMC)',
    goal: 'Sensors, the event log, FRU data, users, firmware inventory and Redfish sessions on real BMC firmware, in QEMU.',
    code: `./obmc.sh fetch && ./obmc.sh run          # log in as root / 0penBmc, wait for obmcutil state
obmc mc info; obmc fru print; obmc sdr elist; obmc sel elist
curl -sk -u root:0penBmc https://127.0.0.1:2443/redfish/v1 | jq .
obmc sel elist > sel-before.txt; obmc sel clear`,
    done: 'Firmware version, FRU, sensors and SEL over IPMI and Redfish, and a Redfish session opened and closed.',
    lessons: ['sel'],
  },
  {
    id: '4',
    title: 'Burn-in and benchmarks',
    goal: 'Load each node, measure it, compare nodes and find the weak one.',
    code: `stress-ng --cpu 2 --cpu-method matrixprod --timeout 60s --metrics-brief
stress-ng --vm 1 --vm-bytes 60% --verify --timeout 60s
sudo fio /tmp/rack.fio --output-format=json > /tmp/fio.json   # filename=/dev/vdb only
./faults.sh inject slow-data-disk rk-n2     # then rerun fio on all three
./faults.sh inject cpu-throttle rk-n3       # then rerun stress-ng`,
    done: 'Baseline numbers written down, thresholds filled in bom.yaml, and both injected outliers found.',
    lessons: ['outlier'],
  },
  {
    id: '5',
    title: 'Networking: bond, MTU, VLAN, cable pull',
    goal: 'Configure and test the back end the way a rack is tested before it ships.',
    code: `# netplan on each node: bond0 (active-backup, be0 primary, mtu 9000) and VLAN 10
ssh rk-n1 cat /proc/net/bonding/bond0
ssh rk-n1 ping -M do -s 8972 -c 3 10.70.0.12
virsh domif-setlink rk-n1 52:54:00:70:01:11 down    # pull be0 with a ping running
./faults.sh inject mtu-mismatch rk-n3
./faults.sh inject flaky-link rk-n2         # counters before and after`,
    done: 'You can explain the bond file line by line and the jumbo arithmetic, and the cable pull loses fewer than 5 pings.',
    lessons: ['jumbo', 'bond', 'flaky'],
  },
  {
    id: '6',
    title: 'Network boot',
    goal: 'Boot a machine with nothing on its disk, and send a rack node to the network boot through its BMC.',
    code: `./pxe.sh fetch
sudo firewall-cmd --zone=libvirt --add-port=8080/tcp
./pxe.sh serve      # terminal A
./pxe.sh vm         # terminal B: a diskless VM boots Alpine from the network`,
    done: 'You can draw the steps from DHCP to the running kernel, and you have seen both failure modes (nobody listening, packets dropped).',
    lessons: ['pxe'],
  },
  {
    id: '7',
    title: 'Windows and PowerShell',
    goal: 'The Windows half of rack work: the same inventory in PowerShell.',
    code: `dotnet tool install --global PowerShell      # PowerShell 7 on Linux, for the language
# then a Windows Server evaluation VM on rack-data:
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores
Get-CimInstance Win32_PhysicalMemory | Select-Object DeviceLocator, Capacity
Get-PhysicalDisk; Get-NetAdapter; Get-WinEvent -FilterHashtable @{LogName='System'; Level=2} -MaxEvents 20`,
    done: 'Inventory.ps1 writes the same JSON fields as the Linux inventory.',
  },
  {
    id: '8',
    title: 'Fault hunt',
    goal: 'Find what is wrong in a rack you did not break yourself, against the clock.',
    code: `./faults.sh random     # one hidden fault on a random node
# triage: reachable? BOM? links, MTU, bond, counters? slower than the others? BMCs?
./faults.sh reveal && ./faults.sh clear`,
    done: 'Ten rounds written up, the last three in under 10 minutes each.',
  },
  {
    id: '9',
    title: 'Real hardware',
    goal: 'Read real hardware, read-only: your own machine.',
    code: `sudo dmidecode -t memory | grep -E 'Locator|Size|Speed'
lspci -tv
sudo lspci -vv -s <NVMe address> | grep -E 'LnkCap|LnkSta'
sudo smartctl -a /dev/nvme0n1; sensors`,
    done: 'You can say how your memory is populated and at what PCIe width and speed your NVMe runs.',
  },
  {
    id: '10',
    title: 'The test report',
    goal: 'Deliver what the customer receives: a rack test report.',
    code: `# per node and for the rack: PASS or FAIL on page one
# every number next to its threshold, every failure with evidence
# firmware versions, MACs and disk serials listed`,
    done: 'A clean report you can present in five minutes, and one from a run with a fault.',
  },
  {
    id: '11',
    title: 'Diskless test nodes at scale (stretch)',
    goal: 'Many nodes boot one test image from the network, run the suite and report to a collector.',
    code: `# boot.ipxe gets an apkovl= overlay that installs the tools and runs a test agent
# six diskless nodes of 384 MB boot at once; the collector gathers their JSON`,
    done: 'Six nodes boot, report, and become one report.',
  },
]

export function Labs({ go }: { go: (hash: string) => void }) {
  return (
    <div className="lesson">
      <header className="lesson-head">
        <div className="eyebrow">Hands on</div>
        <h1>Run it yourself</h1>
        <p className="lead">The lessons on this site have a real counterpart: a three-node rack on KVM with emulated BMCs, a real BMC firmware, network boot and a fault injector, all from the scripts in the repository's lab folder.</p>
      </header>

      <CodeBlock code={SETUP} label="Set up the rack" />
      <p className="muted">
        Scripts:{' '}
        {['provision-rack.sh', 'bmc.sh', 'obmc.sh', 'fw.sh', 'pxe.sh', 'faults.sh', 'snapshot-rack.sh', 'teardown-rack.sh', 'env.sh', 'bom.yaml'].map((f, i) => (
          <span key={f}>
            {i > 0 && ' · '}
            <a href={labFile(f)} target="_blank" rel="noreferrer">
              {f}
            </a>
          </span>
        ))}
      </p>

      <div className="labs">
        {LABS.map((l) => (
          <section key={l.id} className="card lab" id={`lab-${l.id}`}>
            <h2 className="card-title">
              Lab {l.id}: {l.title}
            </h2>
            <p>{l.goal}</p>
            <CodeBlock code={l.code} label="Commands" />
            <p>
              <strong>Done when:</strong> {l.done}
            </p>
            {l.lessons && (
              <p className="muted">
                Lessons:{' '}
                {l.lessons.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ' · '}
                    <a href={`#/lesson/${id}`} onClick={(e) => { e.preventDefault(); go(`#/lesson/${id}`) }}>
                      {lessonById(id)?.title}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

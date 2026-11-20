// A simulated rackbench rack with one hidden fault. The outputs follow what the real lab shows
// for each fault injected by lab/faults.sh (after Lab 5, so bond0 exists).

export type FaultId =
  | 'data-disk-missing'
  | 'slow-data-disk'
  | 'backend-link-down'
  | 'slow-backend'
  | 'memory-missing'
  | 'mgmt-link-down'
  | 'bmc-down'
  | 'cpu-throttle'
  | 'flaky-link'
  | 'bios-drift'
  | 'mtu-mismatch'

export interface FaultInfo {
  id: FaultId
  label: string
  testCase: string
  symptom: string
  evidence: string
  cause: string
  action: string
}

export const FAULTS: FaultInfo[] = [
  { id: 'data-disk-missing', label: 'Data disk missing', testCase: 'TC-BOM-05 disks match the BOM', symptom: 'vdb is not listed; fio cannot open /dev/vdb', evidence: 'lsblk on the node', cause: 'a drive not seated, a dead drive, or a backplane or cable fault', action: 'reseat the drive, then swap it with a known good one; if the bay stays empty, check the backplane' },
  { id: 'slow-data-disk', label: 'Slow data disk', testCase: 'TC-STO-01 storage within 15% of the rack median', symptom: 'random read IOPS far under the other nodes', evidence: 'fio results of all three nodes', cause: 'a different disk model or firmware, a disk wearing out, a controller or PCIe link problem', action: 'compare model, firmware and link width; swap the disk; rerun fio' },
  { id: 'backend-link-down', label: 'Back-end link down', testCase: 'TC-NET-03 bond healthy on both links', symptom: 'be0 has no carrier; bond0 runs on be1 alone; throughput still passes', evidence: '/proc/net/bonding/bond0', cause: 'an unplugged or broken cable, a dead transceiver, a disabled switch port', action: 'check both ends of the be0 cable, swap cable and transceiver, check the switch port' },
  { id: 'slow-backend', label: 'Slow back-end network', testCase: 'TC-NET-02 throughput within 15% of the rack median', symptom: 'iperf3 to and from one node is a tiny fraction of the others', evidence: 'the iperf3 matrix', cause: 'a link that negotiated a lower speed, a wrong cable or transceiver type, a switch port setting', action: 'ethtool on both ends, check the cable type, try a known good cable and another switch port' },
  { id: 'memory-missing', label: 'Memory the OS does not see', testCase: 'TC-BOM-04 memory matches the BOM', symptom: 'MemTotal far below the 1536 MB the board reports', evidence: 'free -m against dmidecode -t memory', cause: 'a DIMM that failed training or was disabled after errors', action: 'read the SEL for memory errors, reseat the DIMM, swap it to find whether the DIMM or the slot is bad' },
  { id: 'mgmt-link-down', label: 'Management link down', testCase: 'TC-NET-01 every node reachable on its management network', symptom: 'SSH and ping fail; the BMC says the power is on', evidence: 'ping, then the BMC power status, then the console', cause: 'an unplugged management cable or a dead switch port', action: 'check the cable and port from the console and the switch; replug or swap' },
  { id: 'bmc-down', label: 'BMC not answering', testCase: 'TC-BMC-01 every BMC reachable over IPMI', symptom: 'IPMI fails for one node while its OS answers on SSH', evidence: 'ipmitool power status', cause: 'a hung BMC, a BMC network setting, an unplugged BMC cable', action: 'reset the BMC (cold reset from the OS with ipmitool mc reset cold), check its LAN settings and cable' },
  { id: 'cpu-throttle', label: 'CPU running slow', testCase: 'TC-CPU-01 CPU stress within 15% of the rack median', symptom: 'stress-ng bogo ops far under the other nodes', evidence: 'stress-ng results of all three nodes', cause: 'thermal throttling (a dead fan, blocked airflow) or a power-capping BIOS setting', action: 'check fans and temperatures in the BMC, CPU frequency under load, BIOS power settings' },
  { id: 'flaky-link', label: 'Intermittent link', testCase: 'TC-NET-04 no link flaps during the run', symptom: 'carrier changes and bond link failures keep rising while every throughput test passes', evidence: 'carrier_changes and the bond failure count, start and end of the run', cause: 'a bad cable, transceiver or switch port that drops the link now and then', action: 'reseat, then swap cable, transceiver and switch port one at a time with the counters read before and after' },
  { id: 'bios-drift', label: 'Wrong BIOS version', testCase: 'TC-BOM-02 BIOS version matches the BOM', symptom: 'one node reports BIOS 1.3, the BOM asks 1.4', evidence: 'fw.sh list, dmidecode -s bios-version', cause: 'a node from another batch, or an update that was skipped', action: 'update that node alone, cold boot, verify from the BMC and the OS, rerun the tests' },
  { id: 'mtu-mismatch', label: 'MTU mismatch', testCase: 'TC-NET-05 jumbo frames between every pair', symptom: '8972-byte pings to and from one node fail', evidence: 'the jumbo-ping matrix, ip link show bond0', cause: 'one port or bond configured at 1500', action: 'set the MTU on that node (and check the switch port), rerun the matrix' },
]

export interface Game {
  fault: FaultId
  node: number // 1..3
  seed: number
  started: number
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function newGame(): Game {
  const seed = Math.floor(Math.random() * 1e9)
  const r = rng(seed)
  return { fault: FAULTS[Math.floor(r() * FAULTS.length)].id, node: 1 + Math.floor(r() * 3), seed, started: Date.now() }
}

const NODES = [1, 2, 3]
const oct = (n: number) => 10 + n

function noise(g: Game, n: number, salt: number) {
  const r = rng(g.seed + n * 7919 + salt * 104729)
  return 1 + (r() - 0.5) * 0.04
}

const has = (g: Game, f: FaultId, n: number) => g.fault === f && g.node === n

/** Parse "rk-n2", "192.168.70.12" or "10.70.0.12" into a node number. */
function nodeOf(s: string): number | null {
  const m = s.match(/rk-n([1-3])\b/) ?? s.match(/\b(?:192\.168\.70|10\.7[01]\.0)\.1([1-3])\b/)
  return m ? Number(m[1]) : null
}

function nodeCmd(g: Game, n: number, cmd: string): string {
  const c = cmd.trim()
  if (has(g, 'mgmt-link-down', n)) return `ssh: connect to host 192.168.70.${oct(n)} port 22: No route to host`

  if (/bios-version/.test(c)) return has(g, 'bios-drift', n) ? '1.3' : '1.4'
  if (/system-serial/.test(c)) return `RL2611-0${oct(n)}`
  if (/dmidecode/.test(c) && /memory/.test(c)) return 'Memory Device\n\tSize: 1536 MB\n\tLocator: DIMM 0\n\tType: RAM'
  if (/^free/.test(c)) {
    const total = has(g, 'memory-missing', n) ? 984 : 1452
    const used = Math.round(210 * noise(g, n, 1))
    return `               total        used        free      shared  buff/cache   available\nMem:            ${total}         ${used}         ${total - used - 260}           1         260        ${total - used - 40}\nSwap:              0           0           0`
  }
  if (/meminfo/.test(c)) return `MemTotal:        ${has(g, 'memory-missing', n) ? 1007616 : 1486848} kB`
  if (/^uptime/.test(c)) return has(g, 'bios-drift', n) ? ' 21:14:03 up 3 min,  0 user,  load average: 0.31, 0.22, 0.09' : ` 21:14:03 up  2:${10 + n}, 0 user,  load average: 0.0${n}, 0.04, 0.01`
  if (/^(nproc|lscpu)/.test(c)) return /nproc/.test(c) ? '2' : 'CPU(s):              2\nSocket(s):           2\nNUMA node(s):        2'
  if (/^lsblk/.test(c)) {
    const vdb = has(g, 'data-disk-missing', n) ? '' : `\nvdb     4G disk RK${oct(n)}-DATA`
    return `NAME  SIZE TYPE SERIAL\nsr0   366K rom  QM00001\nvda    10G disk RK${oct(n)}-OS\n├─vda1  9G part\n└─vda15 106M part${vdb}`
  }
  if (/ip link show bond0/.test(c)) return `7: bond0: <BROADCAST,MULTICAST,MASTER,UP,LOWER_UP> mtu ${has(g, 'mtu-mismatch', n) ? 1500 : 9000} qdisc noqueue state UP mode DEFAULT group default qlen 1000\n    link/ether 52:54:00:70:01:${oct(n)} brd ff:ff:ff:ff:ff:ff`
  if (/ip (-br )?(link|l)\b/.test(c) || /ip -br a/.test(c)) {
    const be0 = has(g, 'backend-link-down', n) ? 'DOWN           52:54:00:70:01:' + oct(n) + ' <NO-CARRIER,BROADCAST,MULTICAST,SLAVE,UP>' : 'UP             52:54:00:70:01:' + oct(n) + ' <BROADCAST,MULTICAST,SLAVE,UP,LOWER_UP>'
    return `lo       UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP>\nmgmt0    UP             52:54:00:70:00:${oct(n)} <BROADCAST,MULTICAST,UP,LOWER_UP>\nbe0      ${be0}\nbe1      UP             52:54:00:70:02:${oct(n)} <BROADCAST,MULTICAST,SLAVE,UP,LOWER_UP>\nbond0    UP             52:54:00:70:01:${oct(n)} <BROADCAST,MULTICAST,MASTER,UP,LOWER_UP>\nbond0.10 UP             52:54:00:70:01:${oct(n)} <BROADCAST,MULTICAST,UP,LOWER_UP>`
  }
  if (/bonding/.test(c)) {
    const down = has(g, 'backend-link-down', n)
    const flaky = has(g, 'flaky-link', n)
    const fails = down ? 1 : flaky ? 7 : 0
    return `Bonding Mode: fault-tolerance (active-backup)\nPrimary Slave: be0 (primary_reselect always)\nCurrently Active Slave: ${down ? 'be1' : 'be0'}\nMII Status: up\nMII Polling Interval (ms): 100\n\nSlave Interface: be0\nMII Status: ${down ? 'down' : 'up'}\nSpeed: Unknown\nLink Failure Count: ${fails}\n\nSlave Interface: be1\nMII Status: up\nSpeed: Unknown\nLink Failure Count: 0`
  }
  if (/carrier_changes/.test(c)) {
    const be1 = /be1/.test(c)
    if (be1) return '2'
    return has(g, 'flaky-link', n) ? '16' : has(g, 'backend-link-down', n) ? '3' : '2'
  }
  if (/dmesg|journalctl/.test(c)) {
    if (has(g, 'flaky-link', n))
      return [1, 2, 3]
        .map((i) => `[ ${(7400 + i * 27).toFixed(6)}] bond0: (slave be0): link status definitely down, disabling slave\n[ ${(7400 + i * 27).toFixed(6)}] bond0: (slave be1): making interface the new active one\n[ ${(7402 + i * 27).toFixed(6)}] bond0: (slave be0): link status definitely up\n[ ${(7402 + i * 27).toFixed(6)}] bond0: (slave be0): making interface the new active one`)
        .join('\n')
    if (has(g, 'backend-link-down', n)) return `[ 7381.204113] bond0: (slave be0): link status definitely down, disabling slave\n[ 7381.204120] bond0: (slave be1): making interface the new active one`
    if (has(g, 'data-disk-missing', n)) return `[ 7390.551021] virtio_blk virtio5: [vdb] detached\n[ 7390.551233] pci 0000:07:00.0: PCI bus device removed`
    return '[  12.418820] bond0: (slave be0): making interface the new active one\n[  12.903114] 8021q: adding VLAN 0 to HW filter on device bond0'
  }
  if (/^sudo fio|^fio/.test(c)) {
    if (has(g, 'data-disk-missing', n)) return 'fio: pid=0, err=2/file:filesetup.c:805, func=open(/dev/vdb), error=No such file or directory'
    const iops = has(g, 'slow-data-disk', n) ? 150 : Math.round(18200 * noise(g, n, 2))
    return `randread-4k: (groupid=0): err= 0\n  read: IOPS=${iops}, BW=${((iops * 4) / 1024).toFixed(1)}MiB/s, 30s\nseqread-1m: (groupid=1): err= 0\n  read: IOPS=${has(g, 'slow-data-disk', n) ? 150 : Math.round(1180 * noise(g, n, 3))}, 30s`
  }
  if (/stress-ng/.test(c)) {
    const bogo = Math.round((has(g, 'cpu-throttle', n) ? 165 : 412) * noise(g, n, 4))
    return `stress-ng: info:  dispatching hogs: 2 cpu\nstress-ng: metrc: stressor   bogo ops   real time  bogo ops/s\nstress-ng: metrc: cpu           ${bogo * 60}       60.00       ${bogo}.0\nstress-ng: info:  successful run completed in 60.01 secs`
  }
  if (/^ping/.test(c)) {
    const t = nodeOf(c.replace(/^ping/, ''))
    if (!t) return 'ping: usage: ping -M do -s 8972 -c 3 10.70.0.1N'
    const jumbo = /-s\s*(\d+)/.exec(c)
    const size = jumbo ? Number(jumbo[1]) : 56
    const big = size + 28 > 1500 && /-M\s*do/.test(c)
    if (big && has(g, 'mtu-mismatch', n)) return `PING 10.70.0.${oct(t)} ${size}(${size + 28}) bytes of data.\nping: local error: message too long, mtu=1500\nping: local error: message too long, mtu=1500\nping: local error: message too long, mtu=1500`
    if (big && has(g, 'mtu-mismatch', t)) return `PING 10.70.0.${oct(t)} ${size}(${size + 28}) bytes of data.\n\n--- 10.70.0.${oct(t)} ping statistics ---\n3 packets transmitted, 0 received, 100% packet loss, time 2041ms`
    return `PING 10.70.0.${oct(t)} ${size}(${size + 28}) bytes of data.\n${size + 8} bytes from 10.70.0.${oct(t)}: icmp_seq=1 ttl=64 time=0.4${n} ms\n${size + 8} bytes from 10.70.0.${oct(t)}: icmp_seq=2 ttl=64 time=0.3${t} ms\n${size + 8} bytes from 10.70.0.${oct(t)}: icmp_seq=3 ttl=64 time=0.41 ms\n\n--- 10.70.0.${oct(t)} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss`
  }
  if (/iperf3/.test(c)) {
    const t = nodeOf(c.replace(/^iperf3/, ''))
    if (!t) return 'iperf3: usage: iperf3 -c 10.70.0.1N'
    return `[SUM]   0.00-15.00  sec  receiver  ${iperf(g, n, t).toFixed(2)} Gbits/sec`
  }
  return `bash: ${c.split(' ')[0]}: try "help" for the commands this simulator knows`
}

function iperf(g: Game, a: number, b: number) {
  if (has(g, 'slow-backend', a) || has(g, 'slow-backend', b)) return 0.016 * noise(g, a + b, 5)
  return (has(g, 'flaky-link', a) || has(g, 'flaky-link', b) ? 20.6 : 21.4) * noise(g, a * 3 + b, 6)
}

export const HELP = [
  { cmd: 'ping rk-n1', what: 'is the node reachable on its management network?' },
  { cmd: 'bmc rk-n1 power status', what: 'ask the node\'s BMC over IPMI' },
  { cmd: 'console rk-n1', what: 'the serial console, for a node you cannot reach' },
  { cmd: 'fw.sh list', what: 'BIOS versions of the rack (your update tool)' },
  { cmd: "onall 'sudo dmidecode -s bios-version'", what: 'run a command on every node' },
  { cmd: "ssh rk-n1 'free -m'", what: 'memory as the OS sees it' },
  { cmd: "ssh rk-n1 'sudo dmidecode -t memory'", what: 'memory as the board reports it' },
  { cmd: "ssh rk-n1 'lsblk'", what: 'disks, with serials' },
  { cmd: "ssh rk-n1 'ip -br link'", what: 'links and carrier state' },
  { cmd: "ssh rk-n1 'ip link show bond0'", what: 'the bond, with its MTU' },
  { cmd: "ssh rk-n1 'cat /proc/net/bonding/bond0'", what: 'active slave and link failure counts' },
  { cmd: "ssh rk-n1 'cat /sys/class/net/be0/carrier_changes'", what: 'link changes since boot' },
  { cmd: "ssh rk-n1 'dmesg | tail'", what: 'the kernel log' },
  { cmd: "ssh rk-n1 'uptime'", what: 'when did it last boot?' },
  { cmd: "ssh rk-n1 'sudo fio /tmp/rack.fio'", what: 'storage test on the data disk' },
  { cmd: "ssh rk-n1 'stress-ng --cpu 2 --timeout 60s --metrics-brief'", what: 'CPU test' },
  { cmd: "ssh rk-n1 'ping -M do -s 8972 -c 3 10.70.0.12'", what: 'jumbo frame to another node' },
  { cmd: "ssh rk-n1 'iperf3 -c 10.70.0.12'", what: 'throughput to another node' },
  { cmd: 'matrix jumbo', what: 'the kit: jumbo ping between every pair' },
  { cmd: 'matrix iperf3', what: 'the kit: throughput between every pair' },
]

/** Run one command line typed by the player. */
export function run(g: Game, line: string): string {
  const input = line.trim().replace(/\s+/g, ' ')
  if (!input) return ''
  if (input === 'help') return HELP.map((h) => `${h.cmd.padEnd(58)} ${h.what}`).join('\n')

  if (/^(\.\/)?(lab\/)?fw\.sh list$/.test(input))
    return 'NODE   VENDOR   VERSION  DATE\n' + NODES.map((n) => `rk-n${n}  RackLab  ${has(g, 'bios-drift', n) ? '1.3      06/15/2026' : '1.4      10/01/2026'}`).join('\n')

  if (/^(bmc|ipmitool)\b/.test(input)) {
    const n = nodeOf(input) ?? (input.match(/-p\s*623([1-3])/) ? Number(input.match(/-p\s*623([1-3])/)![1]) : null)
    if (!n) return 'usage: bmc rk-nN power status'
    if (has(g, 'bmc-down', n)) return 'Error: Unable to establish IPMI v2 / RMCP+ session'
    if (/power status/.test(input)) return 'Chassis Power is on'
    if (/mc info/.test(input) || /sel|sdr/.test(input)) return 'Invalid command (the emulated BMC only does power and boot device)'
    return 'Chassis Power is on'
  }

  if (/^(virsh )?console rk-n[1-3]$/.test(input)) {
    const n = nodeOf(input)!
    const mgmt = has(g, 'mgmt-link-down', n) ? 'mgmt0    DOWN           52:54:00:70:00:' + oct(n) + ' <NO-CARRIER,BROADCAST,MULTICAST,UP>' : 'mgmt0    UP             52:54:00:70:00:' + oct(n) + ' <BROADCAST,MULTICAST,UP,LOWER_UP>'
    return `Connected to domain 'rk-n${n}'\nEscape character is ^]\n\nUbuntu 24.04 LTS rk-n${n} ttyS0\n\nrk-n${n} login: ubuntu (key login simulated)\nubuntu@rk-n${n}:~$ ip -br link | head -2\nlo       UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP>\n${mgmt}`
  }

  if (/^ping (rk-n[1-3]|192\.168\.70\.1[1-3])$/.test(input)) {
    const n = nodeOf(input)!
    if (has(g, 'mgmt-link-down', n)) return `PING 192.168.70.${oct(n)} 56(84) bytes of data.\nFrom 192.168.70.1 icmp_seq=1 Destination Host Unreachable\nFrom 192.168.70.1 icmp_seq=2 Destination Host Unreachable\n\n--- 192.168.70.${oct(n)} ping statistics ---\n3 packets transmitted, 0 received, +2 errors, 100% packet loss`
    return `PING 192.168.70.${oct(n)} 56(84) bytes of data.\n64 bytes from 192.168.70.${oct(n)}: icmp_seq=1 ttl=64 time=0.29 ms\n64 bytes from 192.168.70.${oct(n)}: icmp_seq=2 ttl=64 time=0.31 ms\n\n--- 192.168.70.${oct(n)} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss`
  }

  if (input === 'matrix jumbo') {
    const rows = NODES.map((a) =>
      `rk-n${a}  ` +
      NODES.map((b) => {
        if (a === b) return '   -   '
        if (has(g, 'mgmt-link-down', a)) return ' no ssh'
        return has(g, 'mtu-mismatch', a) ? ' local ' : has(g, 'mtu-mismatch', b) ? ' loss  ' : ' pass  '
      }).join(' '),
    )
    return 'jumbo ping -M do -s 8972, from row to column\n        rk-n1   rk-n2   rk-n3\n' + rows.join('\n')
  }
  if (input === 'matrix iperf3') {
    const rows = NODES.map((a) =>
      `rk-n${a}  ` +
      NODES.map((b) => {
        if (a === b) return '   -   '
        if (has(g, 'mgmt-link-down', a)) return ' no ssh'
        return iperf(g, a, b).toFixed(2).padStart(6) + ' '
      }).join(' '),
    )
    return 'iperf3 Gbit/s, from row to column\n        rk-n1   rk-n2   rk-n3\n' + rows.join('\n')
  }

  const onall = input.match(/^onall ['"]?(.+?)['"]?$/)
  if (onall) return NODES.map((n) => nodeCmd(g, n, onall[1]).split('\n').map((l) => `[rk-n${n}] ${l}`).join('\n')).join('\n')

  const ssh = input.match(/^ssh (rk-n[1-3]|192\.168\.70\.1[1-3]) ['"]?(.+?)['"]?$/)
  if (ssh) return nodeCmd(g, nodeOf(ssh[1])!, ssh[2])
  if (/^ssh rk-n[1-3]$/.test(input)) return 'Interactive shells are not simulated: give the command, for example  ssh rk-n1 \'free -m\''

  return `${input.split(' ')[0]}: unknown here. Type "help" for the commands this simulator knows.`
}

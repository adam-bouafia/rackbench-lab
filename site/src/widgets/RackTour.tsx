import { useState } from 'react'
import type { LessonMeta } from '../engine/types'
import { Card, KeyPoints, LessonHeader, TryIt } from '../engine/ui'
import { markDone } from '../progress'

type Side = 'front' | 'back'
type Net = 'power' | 'mgmt' | 'oob' | 'backend'
type Highlight = 'all' | Net

interface Device {
  id: string
  label: string
  u: number
  kind: 'switch' | 'server'
  info: string[]
}

const NODES = [
  { id: 'rk-n1', u: 10, oct: 11 },
  { id: 'rk-n2', u: 11, oct: 12 },
  { id: 'rk-n3', u: 12, oct: 13 },
]

const DEVICES: Device[] = [
  {
    id: 'mgmt-sw',
    label: 'Management switch',
    u: 42,
    kind: 'switch',
    info: [
      '1U, 48 ports of 1 GbE. Every BMC port (the out-of-band network) and every server management port connect here, usually on separate VLANs.',
      'Tested by: every port linked at the right speed, LLDP neighbours matching the cabling table, every BMC reachable.',
      'On rackbench: the libvirt network rack-data (NAT, DHCP, 192.168.70.0/24) for mgmt0; the emulated BMCs listen on 127.0.0.1.',
    ],
  },
  {
    id: 'be-sw',
    label: 'Back-end switch',
    u: 41,
    kind: 'switch',
    info: [
      '1U, 25 and 100 GbE. The data network: bonds, VLANs, jumbo frames, the traffic of the workload.',
      'Production racks use two of these as a pair (MLAG), with one port of each server bond on each switch, so a whole switch can fail.',
      'On rackbench: the isolated network rack-backend with MTU 9000 (one switch, so the bond is active-backup).',
    ],
  },
  ...NODES.map((n) => ({
    id: n.id,
    label: `${n.id}  ·  RL2611-0${n.oct}`,
    u: n.u,
    kind: 'server' as const,
    info: [
      `1U two-socket server in U${n.u}, serial RL2611-0${n.oct}. The serial must match the asset list for this rack unit: a swapped server is a finding.`,
      'Front: drive bays, power button, UID button and LED (ipmitool chassis identify makes it blink, so you find the right server in a full rack). Air enters here.',
      'Back: two power supplies, the dedicated BMC port, two 1 GbE ports, a 2-port 25 GbE card. Hot air leaves here.',
      `On rackbench: the VM ${n.id}, 2 sockets, 2 NUMA nodes, 1.5 GB, disks vda and vdb.`,
    ],
  })),
]

interface Port {
  id: string
  label: string
  net: Net
  to: string
  purpose: string
  lab: string
}

function serverPorts(oct: number, i: number): Port[] {
  return [
    { id: 'psu1', label: 'PSU 1', net: 'power', to: `PDU A, outlet ${i}`, purpose: 'Power feed A', lab: 'Not emulated: a VM has no power supplies.' },
    { id: 'psu2', label: 'PSU 2', net: 'power', to: `PDU B, outlet ${i}`, purpose: 'Power feed B: either feed alone keeps the server running', lab: 'Not emulated.' },
    { id: 'bmc', label: 'BMC', net: 'oob', to: `Management switch, port ${i}`, purpose: 'Out of band: IPMI, Redfish, web interface, remote console', lab: `Emulated on the host: IPMI 127.0.0.1:${6230 + i}, Redfish 127.0.0.1:8000.` },
    { id: 'mgmt0', label: 'mgmt0', net: 'mgmt', to: `Management switch, port ${10 + i}`, purpose: 'Operating system management: SSH, network boot', lab: `rack-data, 192.168.70.${oct}, MAC 52:54:00:70:00:${oct}` },
    { id: 'be0', label: 'be0', net: 'backend', to: `Back-end switch, port ${2 * i - 1}`, purpose: 'Back end, bond0 primary', lab: `rack-backend, MAC 52:54:00:70:01:${oct}` },
    { id: 'be1', label: 'be1', net: 'backend', to: `Back-end switch, port ${2 * i}`, purpose: 'Back end, bond0 backup (on a second switch in production)', lab: `rack-backend, MAC 52:54:00:70:02:${oct}` },
  ]
}

const NET_LABEL: Record<Net, string> = { power: 'Power', oob: 'BMC (out of band)', mgmt: 'Management', backend: 'Back end' }

// Rack elevation geometry
const U_H = 15
const Y0 = 24
const X0 = 64
const X1 = 392
const yOf = (u: number) => Y0 + (42 - u) * U_H

export function RackTour({ meta }: { meta: LessonMeta }) {
  const [side, setSide] = useState<Side>('back')
  const [hl, setHl] = useState<Highlight>('all')
  const [sel, setSel] = useState<string>('rk-n1')
  const [port, setPort] = useState<string | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())

  const pick = (id: string) => {
    setSel(id)
    setPort(null)
    const next = new Set(seen).add(id)
    setSeen(next)
    if (next.size >= 4) markDone(meta.id)
  }

  const device = DEVICES.find((d) => d.id === sel) ?? (sel === 'pdu-a' || sel === 'pdu-b' ? null : DEVICES[2])
  const node = NODES.find((n) => n.id === sel)
  const ports = node ? serverPorts(node.oct, NODES.indexOf(node) + 1) : []
  const activePort = ports.find((p) => p.id === port)
  const show = (net: Net) => side === 'back' && (hl === 'all' || hl === net)

  const cableColor: Record<Net, string> = { power: 'var(--p-board)', oob: 'var(--p-ipmi)', mgmt: 'var(--p-https)', backend: 'var(--p-dhcp)' }

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />
      <div className="toolbar">
        <div className="seg">
          <button className={side === 'front' ? 'on' : ''} onClick={() => setSide('front')}>
            Front
          </button>
          <button className={side === 'back' ? 'on' : ''} onClick={() => setSide('back')}>
            Back
          </button>
        </div>
        <div className="seg">
          {(['all', 'power', 'oob', 'mgmt', 'backend'] as Highlight[]).map((h) => (
            <button key={h} className={hl === h ? 'on' : ''} onClick={() => setHl(h)} disabled={side === 'front'}>
              {h === 'all' ? 'All cables' : NET_LABEL[h]}
            </button>
          ))}
        </div>
      </div>

      <div className="rack-grid">
        <div className="card">
          <svg viewBox="0 0 470 690" className="rack-svg" role="img" aria-label={`Rack rk-01, ${side} view`}>
            <rect x={X0 - 14} y={Y0 - 10} width={X1 - X0 + 28} height={42 * U_H + 20} rx="6" className="rack-frame" />
            {Array.from({ length: 42 }, (_, i) => 42 - i).map((u) => (
              <g key={u}>
                <line x1={X0} x2={X1} y1={yOf(u) + U_H} y2={yOf(u) + U_H} className="rack-u" />
                {u % 2 === 0 && (
                  <text x={X0 - 20} y={yOf(u) + 11.5} className="rack-unum" textAnchor="end">
                    {u}
                  </text>
                )}
              </g>
            ))}
            {side === 'back' &&
              (['pdu-a', 'pdu-b'] as const).map((p, i) => (
                <g key={p} onClick={() => pick(p)} className={`rack-dev${sel === p ? ' is-sel' : ''}`}>
                  <rect x={i === 0 ? X0 + 2 : X1 - 14} y={Y0 + 30} width="12" height={42 * U_H - 60} rx="3" className="rack-pdu" />
                  <text x={i === 0 ? X0 + 8 : X1 - 8} y={Y0 + 24} textAnchor="middle" className="rack-small">
                    {i === 0 ? 'A' : 'B'}
                  </text>
                </g>
              ))}
            {DEVICES.map((d) => (
              <g key={d.id} className={`rack-dev${sel === d.id ? ' is-sel' : ''}`} onClick={() => pick(d.id)}>
                <rect x={X0 + 18} y={yOf(d.u) + 1} width={X1 - X0 - 36} height={U_H - 2} rx="2" className={`rack-box kind-${d.kind}`} />
                <text x={X0 + 26} y={yOf(d.u) + 11.2} className="rack-label">
                  {side === 'back' && d.kind === 'server' ? `${d.id} (rear)` : d.label}
                </text>
              </g>
            ))}
            {Array.from({ length: 42 }, (_, i) => i + 1)
              .filter((u) => !DEVICES.some((d) => d.u === u))
              .map((u) => (
                <rect key={u} x={X0 + 18} y={yOf(u) + 2} width={X1 - X0 - 36} height={U_H - 4} rx="1.5" className="rack-blank" onClick={() => pick('blank')} />
              ))}
            {/* Cables in the back view: each server to the switches and to both PDUs. */}
            {NODES.map((n, i) => {
              const y = yOf(n.u) + U_H / 2
              const lane = X1 + 18 + i * 9
              return (
                <g key={n.id} className="rack-cables">
                  {show('oob') && <polyline points={`${X1 - 40},${y} ${lane},${y} ${lane},${yOf(42) + 3} ${X1 - 40},${yOf(42) + 3}`} stroke={cableColor.oob} />}
                  {show('mgmt') && <polyline points={`${X1 - 52},${y + 2} ${lane + 3},${y + 2} ${lane + 3},${yOf(42) + 7} ${X1 - 60},${yOf(42) + 7}`} stroke={cableColor.mgmt} />}
                  {show('backend') && <polyline points={`${X1 - 70},${y - 2} ${lane - 3},${y - 2} ${lane - 3},${yOf(41) + 5} ${X1 - 80},${yOf(41) + 5}`} stroke={cableColor.backend} />}
                  {show('power') && (
                    <>
                      <line x1={X0 + 22} y1={y} x2={X0 + 14} y2={y} stroke={cableColor.power} />
                      <line x1={X1 - 22} y1={y + 3} x2={X1 - 14} y2={y + 3} stroke={cableColor.power} />
                    </>
                  )}
                </g>
              )
            })}
            <text x={(X0 + X1) / 2} y={Y0 + 42 * U_H + 30} textAnchor="middle" className="rack-small">
              Rack rk-01, 42U, {side} view. Click any device.
            </text>
          </svg>
        </div>

        <div className="stack">
          <Card title={sel === 'pdu-a' || sel === 'pdu-b' ? `PDU ${sel === 'pdu-a' ? 'A' : 'B'}` : sel === 'blank' ? 'Blanking panel' : device?.label}>
            {sel === 'pdu-a' || sel === 'pdu-b' ? (
              <>
                <p>A power distribution unit on feed {sel === 'pdu-a' ? 'A' : 'B'}, with its own breaker upstream. Servers use C13 and C14 cords; high-power GPU servers use C19 and C20.</p>
                <p>Every server has one power supply on PDU A and one on PDU B, so a whole feed can fail without stopping anything. A rack test proves it: switch one feed off during burn-in; nothing may go down, and every BMC logs a power supply event.</p>
              </>
            ) : sel === 'blank' ? (
              <p>Empty units get blanking panels. Without them, hot air from the back flows round to the front and the servers breathe their own exhaust. Airflow runs front to back: cold aisle in front, hot aisle behind.</p>
            ) : (
              device?.info.map((p) => <p key={p}>{p}</p>)
            )}
          </Card>

          {node && (
            <Card title={`${node.id}, ${side} panel`}>
              <svg viewBox="0 0 640 110" className="panel-svg" role="img" aria-label={`${node.id} ${side} panel`}>
                <rect x="4" y="18" width="632" height="74" rx="6" className="panel-box" />
                {side === 'front' ? (
                  <>
                    {[0, 1, 2, 3].map((b) => (
                      <g key={b}>
                        <rect x={24 + b * 118} y="30" width="108" height="50" rx="4" className={`panel-bay${b < 2 ? ' is-full' : ''}`} />
                        <text x={78 + b * 118} y="60" textAnchor="middle" className="panel-text">
                          {b === 0 ? 'Bay 0: OS (vda)' : b === 1 ? 'Bay 1: data (vdb)' : 'empty'}
                        </text>
                      </g>
                    ))}
                    <circle cx="530" cy="44" r="9" className="panel-btn" />
                    <text x="530" y="70" textAnchor="middle" className="panel-text">
                      power
                    </text>
                    <circle cx="585" cy="44" r="9" className="panel-uid" />
                    <text x="585" y="70" textAnchor="middle" className="panel-text">
                      UID
                    </text>
                  </>
                ) : (
                  ports.map((p, i) => {
                    const x = [14, 548, 150, 230, 340, 420][i]
                    const w = p.net === 'power' ? 78 : 64
                    return (
                      <g key={p.id} className={`panel-port${port === p.id ? ' is-sel' : ''}`} onClick={() => setPort(p.id)}>
                        <rect x={x} y="32" width={w} height="44" rx="4" style={{ stroke: cableColor[p.net] }} />
                        <text x={x + w / 2} y="59" textAnchor="middle" className="panel-text">
                          {p.label}
                        </text>
                      </g>
                    )
                  })
                )}
                <text x="320" y="106" textAnchor="middle" className="rack-small">
                  {side === 'front' ? 'Air in. Drive bays, power button, UID LED.' : 'Air out. Click a port to see its cable.'}
                </text>
              </svg>
              {activePort && (
                <dl className="kv">
                  <dt>Port</dt>
                  <dd>{activePort.label}</dd>
                  <dt>Cable to</dt>
                  <dd>{activePort.to}</dd>
                  <dt>Network</dt>
                  <dd>{NET_LABEL[activePort.net]}</dd>
                  <dt>Purpose</dt>
                  <dd>{activePort.purpose}</dd>
                  <dt>On rackbench</dt>
                  <dd>{activePort.lab}</dd>
                </dl>
              )}
            </Card>
          )}
        </div>
      </div>

      <Card title="The cabling table">
        <p className="muted">Every rack comes with one, and the labels on both ends of each cable match it. A wrong row is a miscabled rack: LLDP on each server port shows which switch port it really reaches.</p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Node</th>
                <th>Port</th>
                <th>Cable to</th>
                <th>Network</th>
                <th>On rackbench</th>
              </tr>
            </thead>
            <tbody>
              {NODES.flatMap((n, i) =>
                serverPorts(n.oct, i + 1).map((p) => (
                  <tr key={n.id + p.id}>
                    <td>{n.id}</td>
                    <td>{p.label}</td>
                    <td>{p.to}</td>
                    <td>
                      <span className="dot" style={{ background: cableColor[p.net] }} />
                      {NET_LABEL[p.net]}
                    </td>
                    <td className="muted">{p.lab}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="two-col">
        <KeyPoints
          points={[
            'Integration levels: L10 is one tested server, L11 a cabled and tested rack, L12 several racks tested as one cluster.',
            'Two PSUs per server, one on each PDU and feed.',
            'Out-of-band (BMC) and in-band (operating system) management are separate networks.',
            'The cabling table is the contract: labels, LLDP and the test results are checked against it.',
          ]}
        />
        <TryIt
          lab={meta.lab}
          items={[
            { cmd: 'source lab/env.sh && virsh net-list', note: 'the two rack networks' },
            { cmd: 'for n in rk-n1 rk-n2 rk-n3; do virsh domiflist $n; done', note: 'every "cable", with its MAC' },
            { cmd: "onall 'ip -br link'", note: 'mgmt0, be0 and be1 on every node' },
          ]}
        />
      </div>
    </div>
  )
}

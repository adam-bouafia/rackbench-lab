import { useEffect, useRef, useState } from 'react'
import type { LessonMeta } from '../engine/types'
import { Card, CodeBlock, KeyPoints, LessonHeader, TryIt } from '../engine/ui'
import { markDone } from '../progress'

type Slave = 'be0' | 'be1'
interface Sim {
  now: number
  link: Record<Slave, boolean>
  mii: Record<Slave, boolean> // what the bond believes
  active: Slave | null
  fails: Record<Slave, number>
  nextMii: number
  nextPing: number
  pings: boolean[]
  sent: number
  lost: number
  log: string[]
  failovers: number
}

const TICK = 20
const PING_EVERY = 200

const fresh = (): Sim => ({
  now: 0,
  link: { be0: true, be1: true },
  mii: { be0: true, be1: true },
  active: 'be0',
  fails: { be0: 0, be1: 0 },
  nextMii: 0,
  nextPing: 0,
  pings: [],
  sent: 0,
  lost: 0,
  log: [],
  failovers: 0,
})

const stamp = (ms: number) => `[${(1000 + ms / 1000).toFixed(6).padStart(12)}]`

function step(s: Sim, miimon: number): Sim {
  const n: Sim = { ...s, link: { ...s.link }, mii: { ...s.mii }, fails: { ...s.fails }, pings: s.pings, log: s.log }
  n.now += TICK
  if (n.now >= n.nextMii) {
    n.nextMii = n.now + miimon
    const log = [...n.log]
    for (const sl of ['be0', 'be1'] as Slave[]) {
      if (n.mii[sl] && !n.link[sl]) {
        n.mii[sl] = false
        n.fails[sl] += 1
        log.push(`${stamp(n.now)} bond0: (slave ${sl}): link status definitely down, disabling slave`)
      } else if (!n.mii[sl] && n.link[sl]) {
        n.mii[sl] = true
        log.push(`${stamp(n.now)} bond0: (slave ${sl}): link status definitely up, 25000 Mbps full duplex`)
      }
    }
    // active-backup with primary be0 and primary_reselect=always
    const want: Slave | null = n.mii.be0 ? 'be0' : n.mii.be1 ? 'be1' : null
    if (want !== n.active) {
      if (want) {
        log.push(`${stamp(n.now)} bond0: (slave ${want}): making interface the new active one`)
        if (n.active !== null) n.failovers += 1
      } else log.push(`${stamp(n.now)} bond0: now running without any active interface!`)
      n.active = want
    }
    n.log = log.slice(-12)
  }
  if (n.now >= n.nextPing) {
    n.nextPing = n.now + PING_EVERY
    const ok = n.active !== null && n.link[n.active]
    n.pings = [...n.pings, ok].slice(-40)
    n.sent += 1
    if (!ok) n.lost += 1
  }
  return n
}

function procBonding(s: Sim, miimon: number) {
  const slave = (sl: Slave, oct: string) =>
    `Slave Interface: ${sl}\nMII Status: ${s.mii[sl] ? 'up' : 'down'}\nSpeed: ${s.mii[sl] ? '25000 Mbps' : 'Unknown'}\nDuplex: ${s.mii[sl] ? 'full' : 'Unknown'}\nLink Failure Count: ${s.fails[sl]}\nPermanent HW addr: 52:54:00:70:${oct}:11\nSlave queue ID: 0`
  return `Ethernet Channel Bonding Driver: v6.8.0

Bonding Mode: fault-tolerance (active-backup)
Primary Slave: be0 (primary_reselect always)
Currently Active Slave: ${s.active ?? 'None'}
MII Status: ${s.active ? 'up' : 'down'}
MII Polling Interval (ms): ${miimon}
Up Delay (ms): 0
Down Delay (ms): 0

${slave('be0', '01')}

${slave('be1', '02')}`
}

export function BondFailover({ meta }: { meta: LessonMeta }) {
  const [miimon, setMiimon] = useState(100)
  const [sim, setSim] = useState<Sim>(fresh)
  const miiRef = useRef(miimon)
  miiRef.current = miimon

  useEffect(() => {
    const id = setInterval(() => setSim((s) => step(s, miiRef.current)), TICK)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (sim.failovers > 0) markDone(meta.id)
  }, [sim.failovers, meta.id])

  const setLink = (sl: Slave, up: boolean) => setSim((s) => ({ ...s, link: { ...s.link, [sl]: up } }))
  const color = (sl: Slave) => (!sim.link[sl] ? 'var(--bad)' : sim.active === sl ? 'var(--ok)' : 'var(--muted)')
  const dash = (sl: Slave) => (!sim.link[sl] ? '6 6' : undefined)

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setLink('be0', !sim.link.be0)}>
          {sim.link.be0 ? 'Pull the be0 cable' : 'Plug be0 back in'}
        </button>
        <button className="btn" onClick={() => setLink('be1', !sim.link.be1)}>
          {sim.link.be1 ? 'Pull be1' : 'Plug be1 back in'}
        </button>
        <label className="speed">
          miimon
          <select value={miimon} onChange={(e) => setMiimon(Number(e.target.value))}>
            <option value={100}>100 ms</option>
            <option value={1000}>1000 ms</option>
          </select>
        </label>
        <button className="btn" onClick={() => setSim(fresh())}>
          Reset
        </button>
      </div>

      <div className="flow-grid">
        <div className="card stage">
          <svg viewBox="20 30 960 362" className="map bond-svg" role="img" aria-label="Bond with two links to two switches">
            <rect x="40" y="150" width="200" height="100" rx="12" className="map-box" />
            <text x="140" y="192" textAnchor="middle" className="map-label">
              rk-n1
            </text>
            <text x="140" y="214" textAnchor="middle" className="map-sub">
              bond0 = be0 + be1
            </text>
            <rect x="430" y="50" width="180" height="62" rx="11" className="map-box" />
            <text x="520" y="86" textAnchor="middle" className="map-label">
              Switch A
            </text>
            <rect x="430" y="288" width="180" height="62" rx="11" className="map-box" />
            <text x="520" y="324" textAnchor="middle" className="map-label">
              Switch B
            </text>
            <line x1="520" y1="112" x2="520" y2="288" className="map-link" />
            <text x="532" y="204" className="map-sub">
              inter-switch link
            </text>
            <rect x="780" y="168" width="180" height="62" rx="11" className="map-box" />
            <text x="870" y="204" textAnchor="middle" className="map-label">
              rk-n2
            </text>
            <line x1="240" y1="180" x2="430" y2="81" stroke={color('be0')} strokeWidth="4" strokeDasharray={dash('be0')} />
            <line x1="240" y1="220" x2="430" y2="319" stroke={color('be1')} strokeWidth="4" strokeDasharray={dash('be1')} />
            <text x="300" y="118" className="map-sub">
              be0 {sim.active === 'be0' ? '(active)' : sim.link.be0 ? '(backup)' : '(no link)'}
            </text>
            <text x="300" y="300" className="map-sub">
              be1 {sim.active === 'be1' ? '(active)' : sim.link.be1 ? '(backup)' : '(no link)'}
            </text>
            <line x1="610" y1="81" x2="780" y2="190" className="map-link" />
            <line x1="610" y1="319" x2="780" y2="210" className="map-link" />
            <text x="40" y="380" className="map-sub">
              ping every 0.2 s:
            </text>
            {sim.pings.map((ok, i) => (
              <rect key={i} x={170 + i * 19} y="366" width="14" height="14" rx="3" fill={ok ? 'var(--ok)' : 'var(--bad)'} />
            ))}
          </svg>
          <p className="stat-line">
            Pings sent {sim.sent}, lost <strong>{sim.lost}</strong> · failovers {sim.failovers} · active: <strong>{sim.active ?? 'none'}</strong>
          </p>
        </div>
        <div className="card msgs">
          <h2 className="card-title">Kernel log</h2>
          <pre className="log">{sim.log.length ? sim.log.join('\n') : 'Pull a cable to see what the bonding driver logs.'}</pre>
        </div>
      </div>

      <div className="two-col">
        <CodeBlock code={procBonding(sim, miimon)} label="cat /proc/net/bonding/bond0 (live)" />
        <Card title="What just happened">
          <p>The link drops at once, but the bond only notices at its next MII check, up to one miimon interval later. Pings sent in that gap are lost. Then the backup becomes active and the bond sends a gratuitous ARP from it, so the switches learn where the MAC address lives now.</p>
          <p>Set miimon to 1000 ms and pull again: more pings are lost. Plug be0 back: as the primary port, it takes over again.</p>
          <p className="muted">Production racks usually bond with LACP (802.3ad, mode 4) to two switches running MLAG, so both links carry traffic. The lab uses active-backup because a Linux bridge does not speak LACP.</p>
        </Card>
      </div>

      <div className="two-col">
        <KeyPoints
          points={[
            'Currently Active Slave and Link Failure Count are the two lines to read first.',
            'Lost packets ≈ the time until the next MII check, divided by the packet interval.',
            'A failure count that moved during a test run is a finding, even if nothing failed.',
          ]}
        />
        <TryIt
          lab={meta.lab}
          items={[
            { cmd: 'ssh rk-n1 cat /proc/net/bonding/bond0' },
            { cmd: 'virsh domif-setlink rk-n1 52:54:00:70:01:11 down', note: 'pull be0 on the real lab, with a ping running' },
            { cmd: 'virsh domif-setlink rk-n1 52:54:00:70:01:11 up' },
          ]}
        />
      </div>
    </div>
  )
}

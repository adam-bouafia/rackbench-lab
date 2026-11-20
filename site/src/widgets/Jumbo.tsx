import { useEffect, useState } from 'react'
import type { LessonMeta } from '../engine/types'
import { Card, CodeBlock, KeyPoints, LessonHeader, TryIt, Verdict } from '../engine/ui'
import { markDone } from '../progress'

type Mtu = 1500 | 9000
const IP_HDR = 20
const ICMP_HDR = 8
const ETH_HDR = 14
const FCS = 4

function MtuPick({ label, value, onChange }: { label: string; value: Mtu; onChange: (m: Mtu) => void }) {
  return (
    <label className="mtu-pick">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) as Mtu)}>
        <option value={1500}>MTU 1500</option>
        <option value={9000}>MTU 9000</option>
      </select>
    </label>
  )
}

export function Jumbo({ meta }: { meta: LessonMeta }) {
  const [src, setSrc] = useState<Mtu>(9000)
  const [sw, setSw] = useState<Mtu>(9000)
  const [dst, setDst] = useState<Mtu>(1500)
  const [payload, setPayload] = useState(8972)
  const [nodes, setNodes] = useState<Mtu[]>([9000, 9000, 1500])

  const packet = payload + ICMP_HDR + IP_HDR
  const frame = packet + ETH_HDR + FCS
  const dies = packet > src ? 'src' : packet > sw ? 'sw' : packet > dst ? 'dst' : null

  const matrixFails = nodes.some((m) => m < 9000)
  useEffect(() => {
    if (dies || matrixFails) markDone(meta.id)
  }, [dies, matrixFails, meta.id])

  const output =
    dies === 'src'
      ? `$ ping -M do -s ${payload} -c 3 10.70.0.13\nPING 10.70.0.13 (10.70.0.13) ${payload}(${packet}) bytes of data.\nping: local error: message too long, mtu=${src}\nping: local error: message too long, mtu=${src}\nping: local error: message too long, mtu=${src}`
      : dies
        ? `$ ping -M do -s ${payload} -c 3 10.70.0.13\nPING 10.70.0.13 (10.70.0.13) ${payload}(${packet}) bytes of data.\n\n--- 10.70.0.13 ping statistics ---\n3 packets transmitted, 0 received, 100% packet loss, time 2046ms`
        : `$ ping -M do -s ${payload} -c 3 10.70.0.13\nPING 10.70.0.13 (10.70.0.13) ${payload}(${packet}) bytes of data.\n${payload + ICMP_HDR} bytes from 10.70.0.13: icmp_seq=1 ttl=64 time=0.412 ms\n${payload + ICMP_HDR} bytes from 10.70.0.13: icmp_seq=2 ttl=64 time=0.388 ms\n${payload + ICMP_HDR} bytes from 10.70.0.13: icmp_seq=3 ttl=64 time=0.401 ms\n\n--- 10.70.0.13 ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss, time 2031ms`

  const where =
    dies === 'src'
      ? 'The sender refuses: the packet is bigger than its own interface MTU and "do not fragment" is set. You get an error at once.'
      : dies === 'sw'
        ? 'The switch drops the frame without a word: a layer 2 switch sends no error back. The ping just times out; the switch port counts an oversize frame.'
        : dies === 'dst'
          ? 'The receiving NIC drops it: the frame is bigger than what that port accepts. The ping times out, and the receiver counts a length error.'
          : 'It arrives. Every hop on the path accepts a packet of this size.'

  const seg = (w: number) => `${Math.max(2, (w / 9100) * 100)}%`

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />

      <Card title="One path: rk-n1 → switch → rk-n3">
        <div className="mtu-path">
          <MtuPick label="rk-n1 bond0" value={src} onChange={setSrc} />
          <span className={`hop-arrow${dies === 'src' ? ' is-dead' : ''}`}>→</span>
          <MtuPick label="switch port" value={sw} onChange={setSw} />
          <span className={`hop-arrow${dies === 'sw' || dies === 'dst' ? ' is-dead' : ''}`}>→</span>
          <MtuPick label="rk-n3 bond0" value={dst} onChange={setDst} />
        </div>
        <div className="payload-row">
          <label>
            Ping payload (-s)
            <input type="number" min={56} max={9000} value={payload} onChange={(e) => setPayload(Math.max(0, Math.min(9200, Number(e.target.value) || 0)))} />
          </label>
          <div className="seg">
            {[1472, 8972, 8973].map((p) => (
              <button key={p} className={payload === p ? 'on' : ''} onClick={() => setPayload(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="frame-bar" aria-label="Frame layout">
          <span className="fb-eth" style={{ width: seg(ETH_HDR) }} title="Ethernet header, 14 bytes" />
          <span className="fb-ip" style={{ width: seg(IP_HDR) }} title="IPv4 header, 20 bytes" />
          <span className="fb-icmp" style={{ width: seg(ICMP_HDR) }} title="ICMP header, 8 bytes" />
          <span className="fb-data" style={{ width: seg(payload) }} title={`payload, ${payload} bytes`} />
          <span className="fb-eth" style={{ width: seg(FCS) }} title="frame check sequence, 4 bytes" />
        </div>
        <p className="mono-line">
          IP packet = {payload} payload + {ICMP_HDR} ICMP + {IP_HDR} IP = <strong>{packet} bytes</strong> (the MTU counts this) · frame on the wire = {frame} bytes with the Ethernet header and FCS
        </p>
        <p>
          <Verdict ok={!dies}>{dies ? 'Does not arrive' : 'Arrives'}</Verdict> {where}
        </p>
        <CodeBlock code={output} label="What ping shows on rk-n1" />
      </Card>

      <Card title="The jumbo-ping matrix: find the odd node">
        <p className="muted">The test kit pings every node from every other node with -M do -s 8972. Set one node to 1500 and watch its row and column turn red.</p>
        <div className="mtu-nodes">
          {nodes.map((m, i) => (
            <MtuPick key={i} label={`rk-n${i + 1}`} value={m} onChange={(v) => setNodes(nodes.map((x, j) => (j === i ? v : x)))} />
          ))}
        </div>
        <div className="table-wrap">
          <table className="data matrix">
            <thead>
              <tr>
                <th>from \ to</th>
                {nodes.map((_, j) => (
                  <th key={j}>rk-n{j + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((a, i) => (
                <tr key={i}>
                  <th>rk-n{i + 1}</th>
                  {nodes.map((b, j) => {
                    if (i === j) return <td key={j} className="muted">-</td>
                    const ok = a >= 9000 && b >= 9000
                    return (
                      <td key={j} className={ok ? 'cell-ok' : 'cell-bad'}>
                        {ok ? 'pass' : a < 9000 ? 'local error' : 'no reply'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="two-col">
        <KeyPoints
          points={[
            '9000 - 20 (IP) - 8 (ICMP) = 8972: the largest ping payload that fits a 9000 MTU.',
            '-M do forbids fragmentation, so a too-small hop shows instead of being hidden.',
            'Too big for the sender: an immediate error. Too big further on: silence and packet loss.',
            'Test every pair: one wrong port shows as one red row and column.',
          ]}
        />
        <TryIt
          lab={meta.lab}
          items={[
            { cmd: 'ssh rk-n1 ping -M do -s 8972 -c 3 10.70.0.12', note: 'passes after Lab 5' },
            { cmd: 'ssh rk-n1 ping -M do -s 8973 -c 3 10.70.0.12', note: 'one byte too big' },
            { cmd: './lab/faults.sh inject mtu-mismatch rk-n3', note: 'then run the matrix' },
          ]}
        />
      </div>
    </div>
  )
}

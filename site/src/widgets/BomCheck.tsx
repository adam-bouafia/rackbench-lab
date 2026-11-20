import { useState } from 'react'
import type { LessonMeta } from '../engine/types'
import { Card, CodeBlock, KeyPoints, LessonHeader, TryIt, Verdict } from '../engine/ui'
import { markDone } from '../progress'

type FaultId = 'dimm' | 'bios' | 'disk' | 'swap' | 'mtu'

const FAULTS: { id: FaultId; label: string }[] = [
  { id: 'dimm', label: 'rk-n2: memory the OS does not see' },
  { id: 'bios', label: 'rk-n3: an older BIOS' },
  { id: 'disk', label: 'rk-n1: data disk missing' },
  { id: 'swap', label: 'rk-n2 and rk-n3 swapped in the rack' },
  { id: 'mtu', label: 'rk-n1: back end at MTU 1500' },
]

const NODES = [
  { id: 'rk-n1', u: 10, oct: 11 },
  { id: 'rk-n2', u: 11, oct: 12 },
  { id: 'rk-n3', u: 12, oct: 13 },
]

interface Row {
  item: string
  expected: string
  found: (n: (typeof NODES)[number], f: Set<FaultId>) => { v: string; why?: string }
}

const ROWS: Row[] = [
  {
    item: 'Serial in this rack unit',
    expected: 'asset list',
    found: (n, f) => {
      if (f.has('swap') && n.id !== 'rk-n1') {
        const other = n.id === 'rk-n2' ? 13 : 12
        return { v: `U${n.u}: RL2611-0${other}`, why: `the asset list puts RL2611-0${n.oct} in U${n.u}` }
      }
      return { v: `U${n.u}: RL2611-0${n.oct}` }
    },
  },
  { item: 'System product', expected: 'RL-2S-1U', found: () => ({ v: 'RL-2S-1U' }) },
  {
    item: 'BIOS version',
    expected: '1.4',
    found: (n, f) => (f.has('bios') && n.id === 'rk-n3' ? { v: '1.3', why: 'not the approved BIOS' } : { v: '1.4' }),
  },
  { item: 'Sockets / NUMA nodes', expected: '2 / 2', found: () => ({ v: '2 / 2' }) },
  { item: 'Memory, board (dmidecode)', expected: '1536 MB', found: () => ({ v: '1536 MB' }) },
  {
    item: 'Memory, OS (MemTotal)',
    expected: '≥ 1413 MB (8% margin)',
    found: (n, f) => (f.has('dimm') && n.id === 'rk-n2' ? { v: '984 MB', why: 'the board reports more than the OS can use' } : { v: '1452 MB' }),
  },
  { item: 'Disk vda', expected: '10 GB, serial …-OS', found: (n) => ({ v: `10 GB, RK${n.oct}-OS` }) },
  {
    item: 'Disk vdb',
    expected: '4 GB, serial …-DATA',
    found: (n, f) => (f.has('disk') && n.id === 'rk-n1' ? { v: 'not found', why: 'a disk in the BOM is missing' } : { v: `4 GB, RK${n.oct}-DATA` }),
  },
  { item: 'NIC mgmt0', expected: 'MAC 52:54:00:70:00:…', found: (n) => ({ v: `52:54:00:70:00:${n.oct}` }) },
  { item: 'NICs be0 / be1', expected: 'MAC …:01:… / …:02:…', found: (n) => ({ v: `…:01:${n.oct} / …:02:${n.oct}` }) },
  {
    item: 'Back-end MTU',
    expected: '9000',
    found: (n, f) => (f.has('mtu') && n.id === 'rk-n1' ? { v: '1500', why: 'jumbo frames will fail to and from this node' } : { v: '9000' }),
  },
]

export function BomCheck({ meta }: { meta: LessonMeta }) {
  const [faults, setFaults] = useState<Set<FaultId>>(new Set(['bios']))
  const [flips, setFlips] = useState(0)

  const flip = (id: FaultId) => {
    const next = new Set(faults)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFaults(next)
    if (flips + 1 >= 2) markDone(meta.id)
    setFlips(flips + 1)
  }

  const results = NODES.map((n) => ROWS.map((r) => r.found(n, faults)))
  const nodeFails = results.map((cells) => cells.filter((c) => c.why).length)
  const findings = NODES.flatMap((n, i) => ROWS.map((r, j) => ({ n, r, c: results[i][j] })).filter((x) => x.c.why))

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />
      <Card title="Break something">
        <p className="muted">Each switch puts one real-world mistake into the rack. The table is what the kit compares after collecting the inventory of every node.</p>
        <div className="toggles">
          {FAULTS.map((f) => (
            <label key={f.id} className={`toggle${faults.has(f.id) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={faults.has(f.id)} onChange={() => flip(f.id)} />
              {f.label}
            </label>
          ))}
        </div>
      </Card>

      <Card title="BOM compliance">
        <div className="table-wrap">
          <table className="data bom">
            <thead>
              <tr>
                <th>Item</th>
                <th>Expected</th>
                {NODES.map((n, i) => (
                  <th key={n.id}>
                    {n.id} <Verdict ok={nodeFails[i] === 0}>{nodeFails[i] === 0 ? 'PASS' : 'FAIL'}</Verdict>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, j) => (
                <tr key={r.item}>
                  <th>{r.item}</th>
                  <td className="muted">{r.expected}</td>
                  {NODES.map((n, i) => {
                    const c = results[i][j]
                    return (
                      <td key={n.id} className={c.why ? 'cell-bad' : ''} title={c.why}>
                        {c.v}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Rack: <Verdict ok={findings.length === 0}>{findings.length === 0 ? 'PASS: start the burn-in' : `FAIL: ${findings.length} finding${findings.length > 1 ? 's' : ''}, no burn-in yet`}</Verdict>
        </p>
      </Card>

      {findings.length > 0 && (
        <CodeBlock
          label="Findings, as the report lists them"
          code={findings.map((x) => `FAIL  ${x.n.id} (U${x.n.u})  ${x.r.item}: expected ${x.r.expected}, found ${x.c.v}  [${x.c.why}]`).join('\n')}
        />
      )}

      <div className="two-col">
        <KeyPoints
          points={[
            'The BOM check runs first: a 24-hour burn-in on a node with the wrong parts is a day lost.',
            'Check serials against the asset list per rack unit, not only the parts.',
            'The board and the OS can disagree about memory: compare dmidecode with MemTotal.',
            'Firmware versions are part of the BOM.',
          ]}
        />
        <TryIt
          lab={meta.lab}
          items={[
            { cmd: "onall 'sudo dmidecode -s system-serial-number; sudo dmidecode -s bios-version'" },
            { cmd: "onall 'grep MemTotal /proc/meminfo; lsblk -o NAME,SIZE,SERIAL'" },
            { cmd: 'cat lab/bom.yaml', note: 'the golden configuration and the asset list' },
            { cmd: './lab/faults.sh inject data-disk-missing rk-n1' },
          ]}
        />
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { LessonMeta } from '../engine/types'
import { Card, CodeBlock, KeyPoints, LessonHeader, TryIt, Verdict } from '../engine/ui'
import { markDone } from '../progress'

const CHANNELS = ['A', 'B', 'C', 'D']
const SLOTS = [1, 2]
const DIMM_GB = 32
const CPUS = [1, 2]

type Pop = Record<string, boolean> // key: `${cpu}-${ch}${slot}`
const key = (cpu: number, ch: string, slot: number) => `${cpu}-${ch}${slot}`

function preset(kind: 'full' | 'one' | 'uneven' | 'onecpu' | 'empty'): Pop {
  const p: Pop = {}
  for (const cpu of CPUS)
    for (const ch of CHANNELS)
      for (const s of SLOTS) {
        let on = false
        if (kind === 'full') on = true
        if (kind === 'one') on = s === 1
        if (kind === 'uneven') on = cpu === 1 ? s === 1 || ch === 'A' : s === 1 && (ch === 'A' || ch === 'B')
        if (kind === 'onecpu') on = cpu === 1 && s === 1
        p[key(cpu, ch, s)] = on
      }
  return p
}

type Train = 'x16g4' | 'x8g4' | 'x16g3'
const TRAIN: Record<Train, { width: number; gen: number; gts: string }> = {
  x16g4: { width: 16, gen: 4, gts: '16GT/s' },
  x8g4: { width: 8, gen: 4, gts: '16GT/s' },
  x16g3: { width: 16, gen: 3, gts: '8GT/s' },
}
const GBPS_PER_LANE: Record<number, number> = { 3: 0.985, 4: 1.969, 5: 3.938 }

export function ServerAnatomy({ meta }: { meta: LessonMeta }) {
  const [pop, setPop] = useState<Pop>(preset('one'))
  const [train, setTrain] = useState<Train>('x16g4')
  const [, setTouched] = useState(0)

  const touch = () => {
    setTouched((t) => {
      if (t + 1 >= 3) markDone(meta.id)
      return t + 1
    })
  }
  const toggle = (k: string) => {
    setPop((p) => ({ ...p, [k]: !p[k] }))
    touch()
  }

  const a = useMemo(() => {
    const perCpu = CPUS.map((cpu) => {
      const perCh = CHANNELS.map((ch) => SLOTS.filter((s) => pop[key(cpu, ch, s)]).length)
      const gb = perCh.reduce((x, y) => x + y, 0) * DIMM_GB
      const used = perCh.filter((n) => n > 0).length
      const slot2first = CHANNELS.some((ch) => pop[key(cpu, ch, 2)] && !pop[key(cpu, ch, 1)])
      const counts = new Set(perCh.filter((n) => n > 0))
      return { cpu, perCh, gb, used, slot2first, uneven: counts.size > 1 }
    })
    const total = perCpu.reduce((x, c) => x + c.gb, 0)
    const checks: { ok: boolean | 'warn'; text: string }[] = []
    if (total === 0) checks.push({ ok: false, text: 'No memory at all: the server stops in POST, usually with beeps or a POST code on the BMC.' })
    else {
      const empty = perCpu.find((c) => c.gb === 0)
      if (empty) checks.push({ ok: false, text: `CPU${empty.cpu} has no memory: every core on it reaches memory across the link to the other CPU (slower). Its NUMA node has no memory of its own.` })
      else checks.push({ ok: true, text: 'Both CPUs have memory of their own.' })
      const s2 = perCpu.filter((c) => c.slot2first)
      checks.push(s2.length ? { ok: 'warn', text: `Slot 2 is filled while slot 1 of the same channel is empty (CPU${s2.map((c) => c.cpu).join(', CPU')}): fill slot 1 first, as the board manual's population table says.` } : { ok: true, text: 'Slot 1 of each channel is filled before slot 2.' })
      const partial = perCpu.filter((c) => c.gb > 0 && c.used < CHANNELS.length)
      checks.push(partial.length ? { ok: 'warn', text: `Not every memory channel is used (CPU${partial.map((c) => c.cpu).join(', CPU')}): memory bandwidth drops with every empty channel.` } : { ok: true, text: 'Every channel of every CPU is used: full memory bandwidth.' })
      const uneven = perCpu.filter((c) => c.uneven)
      checks.push(uneven.length ? { ok: 'warn', text: `Channels hold different numbers of DIMMs (CPU${uneven.map((c) => c.cpu).join(', CPU')}): memory is interleaved unevenly and some addresses are slower.` } : { ok: true, text: 'Every used channel has the same number of DIMMs.' })
      checks.push(perCpu[0].gb === perCpu[1].gb ? { ok: true, text: 'Both NUMA nodes have the same size.' } : { ok: 'warn', text: `NUMA nodes differ (${perCpu[0].gb} GB and ${perCpu[1].gb} GB): a benchmark pinned to one socket gives other numbers than on the other.` })
    }
    return { perCpu, total, checks }
  }, [pop])

  const t = TRAIN[train]
  const linkGBs = t.width * GBPS_PER_LANE[t.gen]
  const nicNeeds = 25 // 2 x 100 GbE at line rate, GB/s per direction

  const dmi = CPUS.flatMap((cpu) =>
    CHANNELS.flatMap((ch) =>
      SLOTS.map((s) => `\tLocator: P${cpu}-DIMM${ch}${s}\n\tSize: ${pop[key(cpu, ch, s)] ? `${DIMM_GB} GB` : 'No Module Installed'}`),
    ),
  ).join('\n')

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />
      <div className="toolbar">
        <span className="muted">Presets:</span>
        <div className="seg">
          <button onClick={() => { setPop(preset('one')); touch() }}>1 per channel</button>
          <button onClick={() => { setPop(preset('full')); touch() }}>Full</button>
          <button onClick={() => { setPop(preset('uneven')); touch() }}>Uneven</button>
          <button onClick={() => { setPop(preset('onecpu')); touch() }}>One CPU only</button>
          <button onClick={() => { setPop(preset('empty')); touch() }}>Empty</button>
        </div>
      </div>

      <div className="board-grid">
        <div className="card">
          <svg viewBox="0 0 760 430" className="board-svg" role="img" aria-label="Top view of a two-socket server board">
            <rect x="6" y="6" width="748" height="418" rx="10" className="board" />
            <text x="20" y="28" className="board-note">front of the server (fans)</text>
            <text x="740" y="28" className="board-note" textAnchor="end">back (I/O, PSUs)</text>
            {CPUS.map((cpu, ci) => {
              const cx = ci === 0 ? 200 : 540
              return (
                <g key={cpu}>
                  <rect x={cx - 62} y={150} width={124} height={124} rx="8" className="board-cpu" />
                  <text x={cx} y={208} textAnchor="middle" className="board-cpu-label">
                    CPU{cpu}
                  </text>
                  <text x={cx} y={228} textAnchor="middle" className="board-sub">
                    NUMA node {cpu - 1}
                  </text>
                  {CHANNELS.map((ch, chi) =>
                    SLOTS.map((s, si) => {
                      const left = chi < 2
                      const order = left ? (chi === 0 ? [0, 1] : [2, 3])[si] : (chi === 2 ? [0, 1] : [2, 3])[si]
                      const x = left ? cx - 150 + order * 20 : cx + 78 + (3 - order) * 20
                      const k = key(cpu, ch, s)
                      const on = pop[k]
                      return (
                        <g key={k} className={`board-dimm${on ? ' is-on' : ''}${s === 1 ? ' is-first' : ''}`} onClick={() => toggle(k)}>
                          <rect x={x} y={92} width="14" height="240" rx="3" />
                          <text x={x + 7} y={350} textAnchor="middle" className="board-slot">
                            {ch}
                            {s}
                          </text>
                        </g>
                      )
                    }),
                  )}
                </g>
              )
            })}
            <line x1={262} y1={212} x2={478} y2={212} className="board-upi" />
            <text x={370} y={204} textAnchor="middle" className="board-sub">
              CPU-to-CPU link
            </text>
            <rect x="110" y="380" width="240" height="22" rx="4" className="board-pcie" />
            <text x="230" y="395" textAnchor="middle" className="board-sub">
              PCIe slot 1 (x16, CPU1): 2 × 100 GbE NIC
            </text>
            <rect x="420" y="380" width="240" height="22" rx="4" className="board-pcie dim" />
            <text x="540" y="395" textAnchor="middle" className="board-sub">
              PCIe slot 2 (x16, CPU2): empty
            </text>
            <rect x="702" y="70" width="42" height="34" rx="4" className="board-bmc" />
            <text x="723" y="91" textAnchor="middle" className="board-sub">
              BMC
            </text>
            <rect x="702" y="130" width="42" height="80" rx="4" className="board-psu" />
            <rect x="702" y="220" width="42" height="80" rx="4" className="board-psu" />
            <text x="723" y="174" textAnchor="middle" className="board-sub">
              PSU1
            </text>
            <text x="723" y="264" textAnchor="middle" className="board-sub">
              PSU2
            </text>
            <text x="370" y="60" textAnchor="middle" className="board-note">
              Click a slot to add or remove a {DIMM_GB} GB DIMM. Slot 1 of each channel is drawn brighter.
            </text>
          </svg>
        </div>

        <div className="stack">
          <Card title={`Memory: ${a.total} GB`}>
            {a.perCpu.map((c) => (
              <div key={c.cpu} className="meter-row">
                <span>
                  CPU{c.cpu}: {c.gb} GB, {c.used} of 4 channels
                </span>
                <div className="meter">
                  <div style={{ width: `${(c.used / 4) * 100}%` }} />
                </div>
              </div>
            ))}
            <ul className="checks">
              {a.checks.map((c) => (
                <li key={c.text}>
                  <Verdict ok={c.ok}>{c.ok === true ? 'OK' : c.ok === 'warn' ? 'Check' : 'Fail'}</Verdict>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </Card>
          <CodeBlock
            label="What Linux would report"
            code={`$ numactl --hardware | grep size\nnode 0 size: ${a.perCpu[0].gb * 1024} MB\nnode 1 size: ${a.perCpu[1].gb * 1024} MB\n$ sudo dmidecode -t memory | grep -E 'Locator: P|Size'\n${dmi}`}
          />
        </div>
      </div>

      <Card title="PCIe: did the card train at full width and speed?">
        <p>A card can come up with fewer lanes or a lower generation than it is built for: a card in the wrong slot, a bad riser, a BIOS setting. Pick what the NIC in slot 1 trained at.</p>
        <div className="seg">
          <button className={train === 'x16g4' ? 'on' : ''} onClick={() => { setTrain('x16g4'); touch() }}>x16 Gen4</button>
          <button className={train === 'x8g4' ? 'on' : ''} onClick={() => { setTrain('x8g4'); touch() }}>x8 Gen4</button>
          <button className={train === 'x16g3' ? 'on' : ''} onClick={() => { setTrain('x16g3'); touch() }}>x16 Gen3</button>
        </div>
        <CodeBlock
          label="sudo lspci -vv -s 17:00.0 | grep -E 'LnkCap|LnkSta'"
          code={`LnkCap:\tPort #0, Speed 16GT/s, Width x16, ASPM not supported\nLnkSta:\tSpeed ${t.gts}${t.gen < 4 ? ' (downgraded)' : ''}, Width x${t.width}${t.width < 16 ? ' (downgraded)' : ''}`}
        />
        <p>
          Link: about <strong>{linkGBs.toFixed(1)} GB/s</strong> per direction. Two 100 GbE ports at full speed need about {nicNeeds} GB/s.{' '}
          {linkGBs >= nicNeeds ? <Verdict ok>Enough</Verdict> : <Verdict ok={false}>Bottleneck: the NIC can never reach line rate</Verdict>}
        </p>
        <p className="muted">GPUs and some other devices lower their link speed when idle to save power: read LnkSta under load before calling it a fault. A lower width is a fault either way.</p>
      </Card>

      <div className="two-col">
        <KeyPoints
          points={[
            'Two sockets means two NUMA nodes: memory and PCIe devices belong to one CPU.',
            'Fill slot 1 of every channel first, the same DIMMs on both CPUs.',
            'Every empty channel costs bandwidth; uneven channels cost consistency.',
            'LnkCap is what a device can do, LnkSta what it trained at.',
          ]}
        />
        <TryIt
          lab={meta.lab}
          items={[
            { cmd: "ssh rk-n1 'lscpu; numactl --hardware'", note: '2 sockets, 2 NUMA nodes' },
            { cmd: 'ssh rk-n1 sudo dmidecode -t memory', note: 'one block per memory device' },
            { cmd: "ssh rk-n1 \"sudo lspci -vv | grep -E '^[0-9a-f]|LnkCap:|LnkSta:'\"" },
            { cmd: './lab/faults.sh inject memory-missing rk-n2', note: 'the OS sees less than the board reports' },
          ]}
        />
      </div>
    </div>
  )
}

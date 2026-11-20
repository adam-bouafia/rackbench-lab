import { useEffect, useState } from 'react'
import type { LessonMeta } from '../engine/types'
import { Card, KeyPoints, LessonHeader, TryIt, Verdict } from '../engine/ui'
import { markDone } from '../progress'

type Metric = 'fio' | 'stress' | 'iperf'
const METRICS: Record<Metric, { label: string; unit: string; base: number; digits: number; fault: string; cause: string }> = {
  fio: { label: 'fio random read, 4k', unit: 'IOPS', base: 18200, digits: 0, fault: 'slow-data-disk', cause: 'same disk model and firmware? same controller and slot? PCIe link width? a disk that is wearing out?' },
  stress: { label: 'stress-ng CPU', unit: 'bogo ops/s', base: 412, digits: 0, fault: 'cpu-throttle', cause: 'thermal throttling (fans, airflow), a power-capping BIOS setting, CPU frequency under load (turbostat)' },
  iperf: { label: 'iperf3 over the back end', unit: 'Gbit/s', base: 21.4, digits: 1, fault: 'slow-backend', cause: 'link speed on both ends (ethtool), cable or transceiver type, switch port settings, error counters' },
}
const NOISE = [0.012, -0.008, 0.003, -0.015, 0.009, -0.004, 0.016, -0.011]
const MIN_PCT = 0.8
const OUTLIER = 0.15

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function Outlier({ meta }: { meta: LessonMeta }) {
  const [metric, setMetric] = useState<Metric>('fio')
  const [count, setCount] = useState(3)
  const [slow, setSlow] = useState<number[]>([0, 18, 0, 0, 0, 0, 0, 0])

  const m = METRICS[metric]
  const values = Array.from({ length: count }, (_, i) => m.base * (1 + NOISE[i]) * (1 - slow[i] / 100))
  const med = median(values)
  const min = m.base * MIN_PCT
  const out = med * (1 - OUTLIER)
  const verdicts = values.map((v) => (v < min ? 'min' : v < out ? 'outlier' : 'pass'))
  const hasOutlier = verdicts.includes('outlier')
  useEffect(() => {
    if (hasOutlier) markDone(meta.id)
  }, [hasOutlier, meta.id])

  const top = m.base * 1.12
  const W = 720
  const H = 250
  const pad = 46
  const bw = (W - pad - 20) / count
  const y = (v: number) => H - 30 - ((H - 60) * v) / top
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: m.digits, minimumFractionDigits: m.digits })
  const name = (i: number) => `rk-n${i + 1}`

  const setOne = (i: number, v: number) => setSlow((s) => s.map((x, j) => (j === i ? v : x)))

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />
      <div className="toolbar">
        <div className="seg">
          {(Object.keys(METRICS) as Metric[]).map((k) => (
            <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>
              {METRICS[k].label}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={count === 3 ? 'on' : ''} onClick={() => setCount(3)}>
            3 nodes
          </button>
          <button className={count === 8 ? 'on' : ''} onClick={() => setCount(8)}>
            8 nodes
          </button>
        </div>
      </div>

      <div className="card">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${m.label} per node`}>
          <line x1={pad} x2={W - 10} y1={y(0)} y2={y(0)} className="chart-axis" />
          {values.map((v, i) => {
            const x = pad + i * bw + bw * 0.18
            const w = bw * 0.64
            const tone = verdicts[i] === 'pass' ? 'ok' : 'bad'
            return (
              <g key={i}>
                <rect x={x} y={y(v)} width={w} height={y(0) - y(v)} rx="4" className={`chart-bar tone-${tone}`} />
                <text x={x + w / 2} y={y(v) - 7} textAnchor="middle" className="chart-val">
                  {fmt(v)}
                </text>
                <text x={x + w / 2} y={H - 12} textAnchor="middle" className="chart-x">
                  {name(i)}
                </text>
              </g>
            )
          })}
          <line x1={pad} x2={W - 10} y1={y(med)} y2={y(med)} className="chart-median" />
          <line x1={pad} x2={W - 10} y1={y(out)} y2={y(out)} className="chart-outlier" />
          <line x1={pad} x2={W - 10} y1={y(min)} y2={y(min)} className="chart-min" />
          <text x={pad - 8} y={y(top * 0.95)} textAnchor="end" className="chart-x">
            {m.unit}
          </text>
        </svg>
        <div className="chart-legend">
          <span><i className="lg-median" /> rack median {fmt(med)}</span>
          <span><i className="lg-outlier" /> outlier line, 15% under the median: {fmt(out)}</span>
          <span><i className="lg-min" /> minimum, 80% of the clean baseline: {fmt(min)}</span>
        </div>
      </div>

      <div className="two-col">
        <Card title="Slow nodes down">
          <div className="sliders">
            {values.map((_, i) => (
              <label key={i} className="slider">
                <span>{name(i)}</span>
                <input type="range" min={0} max={60} value={slow[i]} onChange={(e) => setOne(i, Number(e.target.value))} />
                <span className="num">-{slow[i]}%</span>
              </label>
            ))}
          </div>
          <button className="btn" onClick={() => setSlow([0, 0, 0, 0, 0, 0, 0, 0])}>
            All healthy
          </button>
        </Card>
        <Card title="Verdict per node">
          <ul className="checks">
            {values.map((v, i) => (
              <li key={i}>
                <Verdict ok={verdicts[i] === 'pass'}>{verdicts[i] === 'pass' ? 'PASS' : 'FAIL'}</Verdict>
                <span>
                  {name(i)}: {fmt(v)} {m.unit}
                  {verdicts[i] === 'min' && ', below the minimum.'}
                  {verdicts[i] === 'outlier' && `, above the minimum but ${Math.round((1 - v / med) * 100)}% under the rack median: an outlier. Same hardware should give the same number.`}
                  {verdicts[i] === 'pass' && '.'}
                </span>
              </li>
            ))}
          </ul>
          {verdicts.some((x) => x !== 'pass') && (
            <p className="muted">
              What to check on the slow node: {m.cause}. On rackbench this is the fault <code>{m.fault}</code>.
            </p>
          )}
          {count === 3 && slow.slice(0, 3).filter((s) => s >= 20).length >= 2 && (
            <p className="note">With three nodes and two of them slow, the median itself is slow, so the outlier rule stops working. That is why a fixed minimum from a clean baseline run exists as well.</p>
          )}
        </Card>
      </div>

      <div className="two-col">
        <KeyPoints
          points={[
            'Two rules: a fixed minimum from a clean baseline, and an outlier rule against the rack median of this run.',
            'A node above the minimum can still fail: identical hardware must give near-identical numbers.',
            'The median of the rack is robust: one bad node cannot drag it down.',
            'Burn-in runs for hours because early failures appear under sustained heat and load.',
          ]}
        />
        <TryIt
          lab={meta.lab}
          items={[
            { cmd: 'sudo fio /tmp/rack.fio --output-format=json > /tmp/fio.json', note: 'inside each node, on /dev/vdb only' },
            { cmd: 'stress-ng --cpu 2 --cpu-method matrixprod --timeout 60s --metrics-brief' },
            { cmd: './lab/faults.sh inject slow-data-disk rk-n2', note: 'then rerun fio on all three' },
            { cmd: './lab/faults.sh inject cpu-throttle rk-n3', note: 'then rerun stress-ng' },
          ]}
        />
      </div>
    </div>
  )
}

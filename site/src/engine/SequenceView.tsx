import { useEffect, useRef } from 'react'
import type { Flow } from './types'
import { protoColor } from './types'

const W = 1000
const TOP = 74
const ROW = 46

export function SequenceView({ flow, cur, onPick }: { flow: Flow; cur: number; onPick: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const k = flow.actors.length
  const xs = flow.actors.map((_, i) => (k === 1 ? W / 2 : 100 + i * ((W - 200) / (k - 1))))
  const col = Object.fromEntries(flow.actors.map((a, i) => [a.id, i])) as Record<string, number>
  const H = TOP + flow.steps.length * ROW + 24

  useEffect(() => {
    const el = wrap.current
    if (!el || cur < 0) return
    const scale = el.clientWidth / Math.max(W, 760)
    const y = (TOP + cur * ROW) * scale
    if (y < el.scrollTop + 40 || y > el.scrollTop + el.clientHeight - 60) el.scrollTop = Math.max(0, y - el.clientHeight / 2)
  }, [cur])

  return (
    <div className="seq-wrap" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className="seq" role="img" aria-label="Sequence of messages">
        {flow.actors.map((a, i) => (
          <g key={a.id}>
            <line x1={xs[i]} y1={52} x2={xs[i]} y2={H - 8} className="seq-life" />
            <rect x={xs[i] - 78} y={8} width={156} height={42} rx="9" className="seq-head" />
            <text x={xs[i]} y={34} textAnchor="middle" className="seq-head-text">
              {a.label}
            </text>
          </g>
        ))}
        {flow.steps.map((s, i) => {
          const y = TOP + i * ROW + 20
          const x1 = xs[col[s.from] ?? 0]
          const x2 = xs[col[s.to] ?? 0]
          const state = i < cur ? 'past' : i === cur ? 'current' : 'future'
          const color = protoColor(s.proto)
          const label = `${i + 1}. ${s.summary}`
          if (s.from === s.to) {
            const maxChars = Math.floor((W - x1 - 70) / 7.2)
            return (
              <g key={i} className={`seq-step is-${state}`} onClick={() => onPick(i)}>
                <rect x={0} y={y - 26} width={W} height={ROW} className="seq-hit" />
                <path d={`M${x1} ${y - 8} h34 v16 h-28`} fill="none" stroke={color} strokeWidth="2" />
                <polygon points={`${x1},${y + 8} ${x1 + 9},${y + 3} ${x1 + 9},${y + 13}`} fill={color} />
                <text x={x1 + 44} y={y + 4} className="seq-label">
                  {label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label}
                </text>
              </g>
            )
          }
          const dir = x2 > x1 ? 1 : -1
          const span = Math.abs(x2 - x1)
          const maxChars = Math.max(12, Math.floor(span / 7.2))
          return (
            <g key={i} className={`seq-step is-${state}`} onClick={() => onPick(i)}>
              <rect x={0} y={y - 26} width={W} height={ROW} className="seq-hit" />
              <line x1={x1} y1={y} x2={x2 - dir * 9} y2={y} stroke={color} strokeWidth="2" />
              <polygon points={`${x2},${y} ${x2 - dir * 11},${y - 5.5} ${x2 - dir * 11},${y + 5.5}`} fill={color} />
              <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" className="seq-label">
                {label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

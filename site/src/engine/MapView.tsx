import type { Actor, Badge, Flow } from './types'
import { protoColor } from './types'
import { ActorIcon } from './Icons'

const BW = 204
const BH = 66

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** Badges of every actor after step `cur` (later steps override earlier ones). */
export function stateUpTo(flow: Flow, cur: number): Record<string, Badge> {
  const out: Record<string, Badge> = {}
  for (let i = 0; i <= cur && i < flow.steps.length; i++) Object.assign(out, flow.steps[i].state ?? {})
  return out
}

/** Point where the segment from a's centre towards b leaves a's box. */
function edge(ux: number, uy: number) {
  const dx = Math.abs(ux) < 1e-6 ? Infinity : BW / 2 / Math.abs(ux)
  const dy = Math.abs(uy) < 1e-6 ? Infinity : BH / 2 / Math.abs(uy)
  return Math.min(dx, dy) + 6
}

function segment(a: Actor, b: Actor) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const da = edge(ux, uy)
  const db = edge(ux, uy)
  return { x1: a.x + ux * da, y1: a.y + uy * da, x2: b.x - ux * db, y2: b.y - uy * db, ux, uy }
}

const badgeWidth = (text: string) => 18 + text.length * 7.2

/** A viewBox around the actors, with room for packet labels above and badges below. */
function fit(actors: Actor[]) {
  const x0 = Math.min(...actors.map((a) => a.x)) - BW / 2 - 24
  const x1 = Math.max(...actors.map((a) => a.x)) + BW / 2 + 24
  const y0 = Math.min(...actors.map((a) => a.y)) - BH / 2 - 46
  const y1 = Math.max(...actors.map((a) => a.y)) + BH / 2 + 40
  const w = Math.max(560, x1 - x0)
  const cx = (x0 + x1) / 2
  return `${cx - w / 2} ${y0} ${w} ${y1 - y0}`
}

export function MapView({ flow, cur, t }: { flow: Flow; cur: number; t: number }) {
  const byId = Object.fromEntries(flow.actors.map((a) => [a.id, a])) as Record<string, Actor>
  const step = cur >= 0 ? flow.steps[cur] : null
  const badges = stateUpTo(flow, cur)
  const active = new Set(step ? [step.from, step.to] : [])
  const p = ease(t)

  let packet = null
  if (step && step.from !== step.to && byId[step.from] && byId[step.to]) {
    const s = segment(byId[step.from], byId[step.to])
    const px = s.x1 + (s.x2 - s.x1) * p
    const py = s.y1 + (s.y2 - s.y1) * p
    const color = protoColor(step.proto)
    const head = `${s.x2},${s.y2} ${s.x2 - s.ux * 12 - s.uy * 6},${s.y2 - s.uy * 12 + s.ux * 6} ${s.x2 - s.ux * 12 + s.uy * 6},${s.y2 - s.uy * 12 - s.ux * 6}`
    const lw = 20 + step.proto.length * 9
    packet = (
      <g className="map-packet">
        <line x1={s.x1} y1={s.y1} x2={px} y2={py} stroke={color} strokeWidth="3" strokeLinecap="round" />
        {t >= 1 && <polygon points={head} fill={color} />}
        {t < 1 && (
          <>
            <circle cx={px} cy={py} r="13" fill={color} opacity="0.25" />
            <circle cx={px} cy={py} r="7.5" fill={color} />
          </>
        )}
        <g transform={`translate(${px} ${py - 26})`}>
          <rect x={-lw / 2} y="-12" width={lw} height="22" rx="11" fill={color} />
          <text x="0" y="3.5" textAnchor="middle" className="map-packet-label">
            {step.proto}
          </text>
        </g>
      </g>
    )
  } else if (step && byId[step.from]) {
    const a = byId[step.from]
    const grow = 6 + 16 * p
    packet = (
      <rect
        x={a.x - BW / 2 - grow}
        y={a.y - BH / 2 - grow}
        width={BW + grow * 2}
        height={BH + grow * 2}
        rx={10 + grow}
        fill="none"
        stroke={protoColor(step.proto)}
        strokeWidth="3"
        opacity={1 - p * 0.7}
      />
    )
  }

  return (
    <svg viewBox={fit(flow.actors)} className="map" role="img" aria-label="Map of the devices in this lesson">
      {flow.links.map(([a, b]) => {
        const A = byId[a]
        const B = byId[b]
        if (!A || !B) return null
        return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="map-link" />
      })}
      {flow.actors.map((a) => {
        const badge = badges[a.id]
        return (
          <g key={a.id} className={`map-actor${active.has(a.id) ? ' is-active' : ''}`}>
            <rect x={a.x - BW / 2} y={a.y - BH / 2} width={BW} height={BH} rx="11" className="map-box" />
            <g className="map-icon">
              <ActorIcon kind={a.kind} x={a.x - BW / 2 + 12} y={a.y - 14} />
            </g>
            <text x={a.x - BW / 2 + 52} y={a.sub ? a.y - 4 : a.y + 6} className="map-label">
              {a.label}
            </text>
            {a.sub && (
              <text x={a.x - BW / 2 + 52} y={a.y + 16} className="map-sub">
                {a.sub}
              </text>
            )}
            {badge && (
              <g transform={`translate(${a.x} ${a.y + BH / 2 + 18})`}>
                <rect x={-badgeWidth(badge.text) / 2} y="-12" width={badgeWidth(badge.text)} height="24" rx="12" className={`map-badge tone-${badge.tone ?? 'info'}`} />
                <text x="0" y="4" textAnchor="middle" className="map-badge-text">
                  {badge.text}
                </text>
              </g>
            )}
          </g>
        )
      })}
      {packet}
    </svg>
  )
}

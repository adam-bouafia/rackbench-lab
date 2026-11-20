import type { ActorKind } from './types'

/** Small line icons drawn in a 28 x 28 box, top-left at (x, y). */
export function ActorIcon({ kind, x, y }: { kind: ActorKind; x: number; y: number }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <g transform={`translate(${x} ${y})`} {...s}>
      {kind === 'laptop' && (
        <>
          <rect x="5" y="6" width="18" height="12" rx="1.5" />
          <path d="M2 22h24" />
        </>
      )}
      {kind === 'switch' && (
        <>
          <rect x="2" y="8" width="24" height="12" rx="2" />
          <path d="M6 14h2M10 14h2M14 14h2M18 14h2" />
        </>
      )}
      {kind === 'bmc' && (
        <>
          <rect x="6" y="6" width="16" height="16" rx="2" />
          <path d="M10 2v4M14 2v4M18 2v4M10 22v4M14 22v4M18 22v4M2 10h4M2 18h4M22 10h4M22 18h4" />
          <circle cx="14" cy="14" r="2.5" />
        </>
      )}
      {kind === 'chip' && (
        <>
          <rect x="6" y="6" width="16" height="16" rx="1" />
          <path d="M10 2v4M14 2v4M18 2v4M10 22v4M14 22v4M18 22v4M2 10h4M2 14h4M2 18h4M22 10h4M22 14h4M22 18h4" />
        </>
      )}
      {kind === 'server' && (
        <>
          <rect x="3" y="4" width="22" height="8" rx="1.5" />
          <rect x="3" y="16" width="22" height="8" rx="1.5" />
          <path d="M7 8h6M7 20h6" />
          <circle cx="20" cy="8" r="1" />
          <circle cx="20" cy="20" r="1" />
        </>
      )}
      {kind === 'service' && (
        <>
          <ellipse cx="14" cy="7" rx="9" ry="3" />
          <path d="M5 7v14c0 1.7 4 3 9 3s9-1.3 9-3V7" />
          <path d="M5 14c0 1.7 4 3 9 3s9-1.3 9-3" />
        </>
      )}
      {kind === 'disk' && (
        <>
          <rect x="4" y="4" width="20" height="20" rx="2" />
          <circle cx="14" cy="13" r="5" />
          <path d="M8 21h4" />
        </>
      )}
      {kind === 'person' && (
        <>
          <circle cx="14" cy="9" r="4.5" />
          <path d="M5 25c1-5 4.5-7.5 9-7.5s8 2.5 9 7.5" />
        </>
      )}
      {kind === 'os' && (
        <>
          <rect x="3" y="5" width="22" height="18" rx="2" />
          <path d="M3 10h22M7 15l3 2.5-3 2.5M13 20h6" />
        </>
      )}
      {kind === 'nic' && (
        <>
          <rect x="3" y="8" width="16" height="12" rx="1.5" />
          <path d="M19 11h5v6h-5M7 20v3M11 20v3M15 20v3" />
        </>
      )}
    </g>
  )
}

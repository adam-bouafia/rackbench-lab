import { useState, type ReactNode } from 'react'
import type { LessonMeta } from './types'
import { CHAPTERS } from '../lessons/index'
import { useDone } from '../progress'

export function LessonHeader({ meta }: { meta: LessonMeta }) {
  const done = useDone().includes(meta.id)
  const chapter = CHAPTERS.find((c) => c.id === meta.chapter)
  return (
    <header className="lesson-head">
      <div className="eyebrow">
        {chapter?.title}
        {meta.lab && <span className="chip chip-lab">{meta.lab} on rackbench</span>}
        {done && <span className="chip chip-done">Done</span>}
      </div>
      <h1>{meta.title}</h1>
      <p className="lead">{meta.blurb}</p>
    </header>
  )
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/^\$ /gm, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="code">
      <div className="code-bar">
        <span>{label ?? 'Example'}</span>
        <button className="btn-text" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  )
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ' ' + className : ''}`}>
      {title && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  )
}

export function KeyPoints({ points }: { points: string[] }) {
  return (
    <Card title="Key points">
      <ul className="points">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Card>
  )
}

export function TryIt({ items, lab }: { items: { cmd: string; note?: string }[]; lab?: string }) {
  return (
    <Card title={`Try it on rackbench${lab ? ` (${lab})` : ''}`}>
      <ul className="tryit">
        {items.map((it) => (
          <li key={it.cmd}>
            <code>{it.cmd}</code>
            {it.note && <span>{it.note}</span>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function Verdict({ ok, children }: { ok: boolean | 'warn'; children: ReactNode }) {
  const tone = ok === 'warn' ? 'warn' : ok ? 'ok' : 'bad'
  return <span className={`verdict tone-${tone}`}>{children}</span>
}

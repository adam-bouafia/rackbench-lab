import { useCallback, useEffect, useRef, useState } from 'react'
import type { Flow, LessonMeta } from './types'
import { PROTO_KEY } from './types'
import { MapView } from './MapView'
import { SequenceView } from './SequenceView'
import { CodeBlock, KeyPoints, LessonHeader, TryIt } from './ui'
import { markDone, useStored } from '../progress'
import { setAssistantContext } from '../assistant/Assistant'

// Narration MP3s are optional: site/scripts/narrate.ts writes them and public/audio/manifest.json.
let manifest: Promise<Record<string, number> | null> | null = null
function loadManifest() {
  manifest ??= fetch('audio/manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { lessons?: Record<string, number> } | null) => j?.lessons ?? null)
    .catch(() => null)
  return manifest
}
function useNarration(id: string) {
  const [has, setHas] = useState(false)
  useEffect(() => {
    let live = true
    loadManifest().then((m) => live && setHas(!!m && (m[id] ?? 0) > 0))
    return () => {
      live = false
    }
  }, [id])
  return has
}

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function FlowLesson({ meta, flow }: { meta: LessonMeta; flow: Flow }) {
  const n = flow.steps.length
  const [cur, setCur] = useState(-1)
  const [anim, setAnim] = useState({ key: 0, t: 1 })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useStored<'map' | 'seq'>('rackbench:view', 'map')
  const listRef = useRef<HTMLOListElement>(null)
  const hasAudio = useNarration(meta.id)
  const [narrate, setNarrate] = useStored<'on' | 'off'>('rackbench:narrate', 'off')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [spoken, setSpoken] = useState(true)

  const go = useCallback(
    (i: number, animate = true) => {
      const j = Math.max(-1, Math.min(n - 1, i))
      setCur(j)
      setAnim((a) => ({ key: a.key + 1, t: animate && j >= 0 ? 0 : 1 }))
    },
    [n],
  )

  // Move the packet of the current step along its path.
  useEffect(() => {
    if (anim.t >= 1) return
    const key = anim.key
    const start = performance.now()
    const dur = 900 / speed
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur)
      setAnim((a) => (a.key === key ? { ...a, t: p } : a))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim.key])

  // Narration of the current step, when audio files exist and the viewer turned it on.
  useEffect(() => {
    const a = audioRef.current
    if (narrate !== 'on' || !hasAudio || cur < 0) {
      a?.pause()
      setSpoken(true)
      return
    }
    const audio = a ?? (audioRef.current = new Audio())
    const end = () => setSpoken(true)
    audio.onended = end
    audio.onerror = end
    audio.src = `audio/${meta.id}/${String(cur + 1).padStart(2, '0')}.mp3`
    setSpoken(false)
    audio.play().catch(end)
  }, [cur, narrate, hasAudio, meta.id])
  useEffect(() => () => audioRef.current?.pause(), [])

  // Autoplay: next step once the packet has arrived (and the narration has finished).
  const arrived = anim.t >= 1
  useEffect(() => {
    if (!playing || !arrived || (narrate === 'on' && hasAudio && !spoken)) return
    if (cur >= n - 1) {
      setPlaying(false)
      return
    }
    const id = setTimeout(() => go(cur + 1), 700 / speed)
    return () => clearTimeout(id)
  }, [playing, arrived, cur, n, speed, go, narrate, hasAudio, spoken])

  useEffect(() => {
    if (cur === n - 1) markDone(meta.id)
  }, [cur, n, meta.id])

  // Reset when the lesson changes.
  useEffect(() => {
    setPlaying(false)
    go(-1, false)
  }, [meta.id, go])

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (cur >= n - 1) go(0)
    else if (cur === -1) go(0)
    setPlaying(true)
  }, [playing, cur, n, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowRight') {
        setPlaying(false)
        go(cur + 1)
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false)
        go(cur - 1, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, go, cur])

  // Keep the current message visible in the list without scrolling the page.
  useEffect(() => {
    const list = listRef.current
    if (!list || cur < 0) return
    const row = list.children[cur] as HTMLElement | undefined
    if (!row) return
    const top = row.offsetTop - list.offsetTop
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 3
    }
  }, [cur])

  const step = cur >= 0 ? flow.steps[cur] : null
  const name = (id: string) => flow.actors.find((a) => a.id === id)?.label ?? id

  useEffect(() => {
    const s = cur >= 0 ? flow.steps[cur] : null
    setAssistantContext({
      page: meta.title,
      text: s
        ? `Step ${cur + 1} of ${flow.steps.length}: ${s.summary} (${s.proto}, ${s.from} to ${s.to})\n${s.explain.join(' ')}\n${(s.fields ?? []).map((f) => `${f.name}: ${f.value}${f.note ? ` (${f.note})` : ''}`).join('\n')}`
        : flow.intro.join(' '),
    })
  }, [cur, flow, meta.title])

  return (
    <div className="lesson">
      <LessonHeader meta={meta} />

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="View">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            Map
          </button>
          <button className={view === 'seq' ? 'on' : ''} onClick={() => setView('seq')}>
            Sequence
          </button>
        </div>
        <div className="controls">
          <button className="btn" onClick={() => { setPlaying(false); go(-1, false) }} title="Back to the start">
            ⏮
          </button>
          <button className="btn" onClick={() => { setPlaying(false); go(cur - 1, false) }} disabled={cur < 0} title="Previous step (left arrow)">
            ◀
          </button>
          <button className="btn btn-primary" onClick={togglePlay} title="Play or pause (space)">
            {playing ? '❚❚ Pause' : cur >= n - 1 ? '↻ Replay' : '▶ Play'}
          </button>
          <button className="btn" onClick={() => { setPlaying(false); go(cur + 1) }} disabled={cur >= n - 1} title="Next step (right arrow)">
            ▶
          </button>
        </div>
        <span className="stepcount">{cur < 0 ? `${n} steps` : `Step ${cur + 1} of ${n}`}</span>
        {hasAudio && (
          <button className={`btn${narrate === 'on' ? ' btn-on' : ''}`} onClick={() => setNarrate(narrate === 'on' ? 'off' : 'on')} title="Read each step aloud">
            Narration {narrate === 'on' ? 'on' : 'off'}
          </button>
        )}
        <label className="speed">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>

      <div className="flow-grid">
        <div className="card stage">
          {view === 'map' ? <MapView flow={flow} cur={cur} t={anim.t} /> : <SequenceView flow={flow} cur={cur} onPick={(i) => { setPlaying(false); go(i) }} />}
        </div>
        <div className="card msgs">
          <h2 className="card-title">Messages</h2>
          <ol className="msglist" ref={listRef}>
            {flow.steps.map((s, i) => (
              <li key={i} className={i === cur ? 'is-current' : i > cur ? 'is-future' : ''}>
                <button onClick={() => { setPlaying(false); go(i) }}>
                  <span className="msg-n">{i + 1}</span>
                  <span className={`chip proto`} data-proto={PROTO_KEY[s.proto]}>
                    {s.proto}
                  </span>
                  <span className="msg-route">
                    {name(s.from)} {s.from === s.to ? '' : `→ ${name(s.to)}`}
                  </span>
                  <span className="msg-sum">{s.summary}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <section className="card inspector" aria-live="polite">
        {!step ? (
          <>
            <h2 className="card-title">Before you start</h2>
            {flow.intro.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <dl className="legend">
              {flow.actors.map((a) => (
                <div key={a.id}>
                  <dt>{a.label}</dt>
                  <dd>{a.sub}</dd>
                </div>
              ))}
            </dl>
            <p className="hint">Press Play, or step with the arrow keys. Space plays and pauses. Click any message to inspect it.</p>
          </>
        ) : (
          <>
            <div className="insp-head">
              <span className="msg-n">{cur + 1}</span>
              <span className="chip proto" data-proto={PROTO_KEY[step.proto]}>
                {step.proto}
              </span>
              <span className="insp-route">
                {name(step.from)}
                {step.from !== step.to && <> → {name(step.to)}</>}
              </span>
            </div>
            <h2 className="insp-title">{step.summary}</h2>
            <div className="insp-body">
              <div>
                {step.explain.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
              {step.fields && (
                <table className="fields">
                  <tbody>
                    {step.fields.map((f) => (
                      <tr key={f.name}>
                        <th>{f.name}</th>
                        <td>
                          <code>{f.value}</code>
                          {f.note && <span className="field-note">{f.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {step.raw && <CodeBlock code={step.raw} label={step.rawLabel} />}
          </>
        )}
      </section>

      <div className="two-col">
        <KeyPoints points={flow.keyPoints} />
        {flow.tryIt && <TryIt items={flow.tryIt} lab={meta.lab} />}
      </div>
      <p className="fine">The traces are illustrative: addresses, identifiers and timings are made up, and some exchanges are simplified. Use them to understand the order and the meaning of each message before you read a specification or a real capture.</p>
    </div>
  )
}

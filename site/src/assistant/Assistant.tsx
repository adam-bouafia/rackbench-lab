import { useEffect, useRef, useState } from 'react'

// The "Ask the rack" assistant. It only appears in builds made with VITE_ASSISTANT=1, which need
// the serverless function in site/api/ask.ts (Vercel). Static builds (GitHub Pages) leave it out.
const ENABLED = import.meta.env.VITE_ASSISTANT === '1'

interface Ctx {
  page: string
  text: string
}
let current: Ctx = { page: '', text: '' }

/** Lessons call this when the viewer moves to another page or step. */
export function setAssistantContext(c: Ctx) {
  current = c
}

interface Msg {
  role: 'user' | 'assistant'
  text: string
}

const STARTERS = ['Why is the password never sent in IPMI?', 'What does LnkSta lower than LnkCap mean?', 'How do I prove jumbo frames work end to end?']

function Panel() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, busy])

  const ask = async (question: string) => {
    const text = question.trim().slice(0, 600)
    if (!text || busy) return
    setErr('')
    setBusy(true)
    const history = msgs.slice(-4)
    setMsgs((m) => [...m, { role: 'user', text }])
    setQ('')
    try {
      const r = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, page: current.page, context: current.text.slice(0, 3000), history }),
      })
      const data = (await r.json().catch(() => ({}))) as { answer?: string; error?: string }
      if (!r.ok || !data.answer) throw new Error(data.error ?? `The assistant is not available (${r.status}).`)
      setMsgs((m) => [...m, { role: 'assistant', text: data.answer! }])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button className="ask-fab" onClick={() => setOpen(true)}>
        Ask the rack
      </button>
    )

  return (
    <div className="ask-panel" role="dialog" aria-label="Ask a question about this page">
      <div className="ask-head">
        <strong>Ask the rack</strong>
        <button className="btn-text" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="ask-list" ref={listRef}>
        {msgs.length === 0 && (
          <div className="ask-empty">
            <p>Questions about this page, or about rack testing in general. The current lesson and step are sent along.</p>
            {STARTERS.map((s) => (
              <button key={s} className="btn-text" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ask-${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="ask-msg ask-assistant muted">Thinking…</div>}
        {err && <div className="ask-err">{err}</div>}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          ask(q)
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this step…" maxLength={600} />
        <button className="btn btn-primary" disabled={busy || !q.trim()}>
          Send
        </button>
      </form>
      <p className="ask-note">Answers come from an AI model and can be wrong. Check them against the lesson and the lab.</p>
    </div>
  )
}

export function Assistant() {
  return ENABLED ? <Panel /> : null
}

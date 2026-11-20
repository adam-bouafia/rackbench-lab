import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FAULTS, HELP, newGame, run, type FaultId, type Game } from './sim'
import { Card, KeyPoints, TryIt, Verdict } from '../engine/ui'
import { markDone } from '../progress'

interface Line {
  kind: 'in' | 'out' | 'sys'
  text: string
}

const PROMPT = 'you@host:~/rackbench$'
const BEST_KEY = 'rackbench:hunt-best'

function readBest(): number | null {
  try {
    const v = localStorage.getItem(BEST_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function FaultHunt() {
  const [game, setGame] = useState<Game>(newGame)
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hpos, setHpos] = useState(-1)
  const [now, setNow] = useState(Date.now())
  const [guess, setGuess] = useState<{ node: number; fault: FaultId | '' }>({ node: 0, fault: '' })
  const [result, setResult] = useState<null | { node: boolean; fault: boolean; ms: number; cmds: number }>(null)
  const [best, setBest] = useState<number | null>(readBest)
  const termRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (result) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [result])

  useEffect(() => {
    const el = termRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const start = () => {
    setGame(newGame())
    setLines([{ kind: 'sys', text: 'One fault is hidden somewhere in rack rk-01 (three nodes, bond0 configured). Find it with the tools below, then name the node and the fault. Type "help" for the commands.' }])
    setResult(null)
    setGuess({ node: 0, fault: '' })
    setHistory([])
    setNow(Date.now())
    inputRef.current?.focus()
  }

  useEffect(() => {
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (line: string) => {
    const cmd = line.trim()
    if (!cmd) return
    if (cmd === 'clear') {
      setLines([])
    } else {
      setLines((ls) => [...ls, { kind: 'in', text: cmd }, { kind: 'out', text: run(game, cmd) }])
    }
    setHistory((h) => [...h, cmd])
    setHpos(-1)
    setInput('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit(input)
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const p = hpos < 0 ? history.length - 1 : Math.max(0, hpos - 1)
      setHpos(p)
      setInput(history[p])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (hpos < 0) return
      const p = hpos + 1
      if (p >= history.length) {
        setHpos(-1)
        setInput('')
      } else {
        setHpos(p)
        setInput(history[p])
      }
    }
  }

  const answer = () => {
    if (!guess.node || !guess.fault) return
    const ms = Date.now() - game.started
    const r = { node: guess.node === game.node, fault: guess.fault === game.fault, ms, cmds: history.length }
    setResult(r)
    if (r.node && r.fault) {
      markDone('fault-hunt')
      if (best === null || ms < best) {
        setBest(ms)
        try {
          localStorage.setItem(BEST_KEY, String(ms))
        } catch {
          /* ignore */
        }
      }
    }
  }

  const info = FAULTS.find((f) => f.id === game.fault)!
  const elapsed = (result ? result.ms : now - game.started) || 0

  return (
    <div className="lesson">
      <header className="lesson-head">
        <div className="eyebrow">Practice</div>
        <h1>Fault hunt</h1>
        <p className="lead">A rack with one hidden fault, the tools a rack engineer has, and a clock. The outputs follow what the real lab prints for each fault that lab/faults.sh can inject.</p>
      </header>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={start}>
          New round
        </button>
        <span className="stepcount">Time {mmss(elapsed)}</span>
        <span className="stepcount">Commands {history.length}</span>
        {best !== null && <span className="stepcount">Best {mmss(best)}</span>}
      </div>

      <div className="hunt-grid">
        <div className="term" onClick={() => inputRef.current?.focus()}>
          <div className="term-out" ref={termRef}>
            {lines.map((l, i) => (
              <div key={i} className={`term-${l.kind}`}>
                {l.kind === 'in' ? (
                  <>
                    <span className="term-prompt">{PROMPT}</span> {l.text}
                  </>
                ) : (
                  l.text
                )}
              </div>
            ))}
          </div>
          <div className="term-line">
            <span className="term-prompt">{PROMPT}</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-label="Command"
              disabled={!!result}
            />
          </div>
        </div>

        <Card title="Commands" className="help-card">
          <p className="muted">Click one to put it in the prompt, then change the node.</p>
          <ul className="help-list">
            {HELP.map((h) => (
              <li key={h.cmd}>
                <button
                  onClick={() => {
                    setInput(h.cmd)
                    inputRef.current?.focus()
                  }}
                >
                  <code>{h.cmd}</code>
                  <span>{h.what}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Your finding">
        <div className="answer">
          <label>
            Node
            <select value={guess.node} onChange={(e) => setGuess({ ...guess, node: Number(e.target.value) })} disabled={!!result}>
              <option value={0}>choose</option>
              <option value={1}>rk-n1</option>
              <option value={2}>rk-n2</option>
              <option value={3}>rk-n3</option>
            </select>
          </label>
          <label>
            Fault
            <select value={guess.fault} onChange={(e) => setGuess({ ...guess, fault: e.target.value as FaultId })} disabled={!!result}>
              <option value="">choose</option>
              {FAULTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={answer} disabled={!guess.node || !guess.fault || !!result}>
            Submit
          </button>
        </div>
        {result && (
          <div className="result">
            <p>
              <Verdict ok={result.node && result.fault}>{result.node && result.fault ? 'Correct' : 'Not quite'}</Verdict> Node {result.node ? 'right' : 'wrong'}, fault {result.fault ? 'right' : 'wrong'}, in {mmss(result.ms)} with {result.cmds} commands. It was <strong>{info.label}</strong> on <strong>rk-n{game.node}</strong>.
            </p>
            <table className="fields">
              <tbody>
                <tr>
                  <th>Node</th>
                  <td>rk-n{game.node}, serial RL2611-0{10 + game.node}, U{9 + game.node}</td>
                </tr>
                <tr>
                  <th>Test case</th>
                  <td>{info.testCase}</td>
                </tr>
                <tr>
                  <th>Symptom</th>
                  <td>{info.symptom}</td>
                </tr>
                <tr>
                  <th>Evidence</th>
                  <td>{info.evidence}</td>
                </tr>
                <tr>
                  <th>On a real rack</th>
                  <td>{info.cause}</td>
                </tr>
                <tr>
                  <th>Action</th>
                  <td>{info.action}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted">
              Same fault on the real lab: <code>./lab/faults.sh inject {game.fault} rk-n{game.node}</code>
            </p>
            <button className="btn btn-primary" onClick={start}>
              Next round
            </button>
          </div>
        )}
      </Card>

      <div className="two-col">
        <KeyPoints
          points={[
            'Triage order: reachable? matches the BOM? links, MTU and bond healthy? any node slower than the others? all BMCs answer?',
            'Compare nodes with each other: the odd one out is the suspect.',
            'Write the finding before you look at the answer: node, symptom, evidence, cause, action.',
            'Quiet faults exist: a link that flaps passes throughput tests, a throttled CPU only shows under load.',
          ]}
        />
        <TryIt
          items={[
            { cmd: './lab/faults.sh random', note: 'the same game on the real lab' },
            { cmd: './lab/faults.sh reveal' },
            { cmd: './lab/faults.sh clear' },
          ]}
          lab="Lab 8"
        />
      </div>
    </div>
  )
}

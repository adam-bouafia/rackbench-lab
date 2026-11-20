import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from 'react'
import { CHAPTERS, LESSONS, lessonById } from './lessons/index'
import { FLOWS } from './lessons/flows'
import type { LessonMeta } from './engine/types'
import { FlowLesson } from './engine/FlowLesson'
import { RackTour } from './widgets/RackTour'
import { ServerAnatomy } from './widgets/ServerAnatomy'
import { BomCheck } from './widgets/BomCheck'
import { Outlier } from './widgets/Outlier'
import { Jumbo } from './widgets/Jumbo'
import { BondFailover } from './widgets/BondFailover'
import { FaultHunt } from './hunt/FaultHunt'
import { Home } from './pages/Home'
import { Labs } from './pages/Labs'
import { Assistant, setAssistantContext } from './assistant/Assistant'
import { useDone, useStored } from './progress'
import { SITE } from './site'

const WIDGETS: Record<string, ComponentType<{ meta: LessonMeta }>> = {
  'rack-tour': RackTour,
  'server-anatomy': ServerAnatomy,
  'bom-check': BomCheck,
  outlier: Outlier,
  jumbo: Jumbo,
  bond: BondFailover,
}

type Route = { page: 'home' } | { page: 'lesson'; id: string } | { page: 'hunt' } | { page: 'labs' } | { page: 'missing' }

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '') || '/'
  if (h === '/' || h === '') return { page: 'home' }
  if (h === '/hunt') return { page: 'hunt' }
  if (h === '/labs') return { page: 'labs' }
  const m = h.match(/^\/lesson\/([\w-]+)$/)
  if (m && lessonById(m[1])) return { page: 'lesson', id: m[1] }
  return { page: 'missing' }
}

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

const PAGES = [
  { hash: '#/', title: 'Home', blurb: 'Start page', keywords: ['home', 'start'] },
  { hash: '#/hunt', title: 'Fault hunt', blurb: 'Find the hidden fault in a simulated rack', keywords: ['game', 'fault', 'hunt', 'practice', 'terminal'] },
  { hash: '#/labs', title: 'Run it yourself', blurb: 'Labs 0 to 11 on the real three-node rack', keywords: ['lab', 'install', 'setup', 'hands on', 'scripts'] },
]

function Search({ open, onClose, go }: { open: boolean; onClose: () => void; go: (h: string) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => ref.current?.focus(), 0)
    }
  }, [open])
  const items = useMemo(() => {
    const all = [...LESSONS.map((l) => ({ hash: `#/lesson/${l.id}`, title: l.title, blurb: l.blurb, keywords: l.keywords })), ...PAGES]
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return all
    return all.filter((i) => {
      const hay = `${i.title} ${i.blurb} ${i.keywords.join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [q])
  if (!open) return null
  return (
    <div className="palette-bg" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search lessons">
        <input
          ref={ref}
          value={q}
          placeholder="Search lessons: ipmi, mtu, bond, pxe, dimm…"
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(items.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter' && items[sel]) {
              go(items[sel].hash)
              onClose()
            }
          }}
        />
        <ul>
          {items.map((i, n) => (
            <li key={i.hash} className={n === sel ? 'is-sel' : ''}>
              <button
                onMouseEnter={() => setSel(n)}
                onClick={() => {
                  go(i.hash)
                  onClose()
                }}
              >
                <strong>{i.title}</strong>
                <span>{i.blurb}</span>
              </button>
            </li>
          ))}
          {!items.length && <li className="muted pad">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  )
}

export function App() {
  const hash = useHash()
  const route = parse(hash)
  const done = useDone()
  const [navOpen, setNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [theme, setTheme] = useStored<'' | 'light' | 'dark'>('rackbench:theme', '')

  const go = useCallback((h: string) => {
    if (window.location.hash !== h) window.location.hash = h
  }, [])
  const link = (h: string) => (e: MouseEvent) => {
    e.preventDefault()
    go(h)
  }

  useEffect(() => {
    window.scrollTo(0, 0)
    setNavOpen(false)
    const lesson = route.page === 'lesson' ? lessonById(route.id) : null
    document.title = lesson ? `${lesson.title} · ${SITE.title}` : route.page === 'hunt' ? `Fault hunt · ${SITE.title}` : route.page === 'labs' ? `Run it yourself · ${SITE.title}` : SITE.title
    setAssistantContext(lesson ? { page: lesson.title, text: lesson.blurb } : { page: route.page, text: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash])

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  }, [theme])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const toggleTheme = () => {
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    setTheme(dark ? 'light' : 'dark')
  }

  const idx = route.page === 'lesson' ? LESSONS.findIndex((l) => l.id === route.id) : -1
  const prev = idx > 0 ? LESSONS[idx - 1] : null
  const next = idx >= 0 && idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null

  let main
  if (route.page === 'home') main = <Home go={go} />
  else if (route.page === 'hunt') main = <FaultHunt />
  else if (route.page === 'labs') main = <Labs go={go} />
  else if (route.page === 'lesson') {
    const meta = lessonById(route.id)!
    const W = WIDGETS[meta.id]
    main = (
      <>
        {meta.kind === 'flow' && FLOWS[meta.id] ? <FlowLesson key={meta.id} meta={meta} flow={FLOWS[meta.id]} /> : W ? <W key={meta.id} meta={meta} /> : null}
        <nav className="pager">
          {prev ? (
            <a href={`#/lesson/${prev.id}`} onClick={link(`#/lesson/${prev.id}`)}>
              ← {prev.title}
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a href={`#/lesson/${next.id}`} onClick={link(`#/lesson/${next.id}`)}>
              {next.title} →
            </a>
          ) : (
            <a href="#/hunt" onClick={link('#/hunt')}>
              Fault hunt →
            </a>
          )}
        </nav>
      </>
    )
  } else
    main = (
      <div className="lesson">
        <h1>Not found</h1>
        <p>
          <a href="#/" onClick={link('#/')}>
            Back to the start
          </a>
        </p>
      </div>
    )

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn nav-toggle" onClick={() => setNavOpen(!navOpen)} aria-label="Lessons">
          ☰
        </button>
        <a className="brand" href="#/" onClick={link('#/')}>
          <img src="./favicon.svg" alt="" width="22" height="22" />
          <span>{SITE.name}</span>
          <em>Explorer</em>
        </a>
        <nav className="topnav">
          <a href="#/hunt" onClick={link('#/hunt')} className={route.page === 'hunt' ? 'on' : ''}>
            Fault hunt
          </a>
          <a href="#/labs" onClick={link('#/labs')} className={route.page === 'labs' ? 'on' : ''}>
            Run it yourself
          </a>
          <a href={SITE.repo} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <button className="btn search-btn" onClick={() => setSearchOpen(true)}>
          Search <kbd>Ctrl K</kbd>
        </button>
        <button className="btn" onClick={toggleTheme} aria-label="Switch light or dark theme" title="Light or dark">
          ◐
        </button>
      </header>

      <div className="layout">
        <aside className={`sidebar${navOpen ? ' is-open' : ''}`}>
          {CHAPTERS.map((c) => (
            <div key={c.id} className="side-group">
              <h3>{c.title}</h3>
              <ul>
                {LESSONS.filter((l) => l.chapter === c.id).map((l) => (
                  <li key={l.id}>
                    <a href={`#/lesson/${l.id}`} onClick={link(`#/lesson/${l.id}`)} className={route.page === 'lesson' && route.id === l.id ? 'on' : ''}>
                      <span className={`check${done.includes(l.id) ? ' is-done' : ''}`} aria-hidden="true" />
                      {l.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="side-group">
            <h3>Practice</h3>
            <ul>
              <li>
                <a href="#/hunt" onClick={link('#/hunt')} className={route.page === 'hunt' ? 'on' : ''}>
                  <span className={`check${done.includes('fault-hunt') ? ' is-done' : ''}`} aria-hidden="true" />
                  Fault hunt
                </a>
              </li>
              <li>
                <a href="#/labs" onClick={link('#/labs')} className={route.page === 'labs' ? 'on' : ''}>
                  <span className="check" aria-hidden="true" />
                  Run it yourself
                </a>
              </li>
            </ul>
          </div>
        </aside>
        <main className="content">{main}</main>
      </div>

      <footer className="footer">
        <span>
          {SITE.title} · by{' '}
          <a href={SITE.authorUrl} target="_blank" rel="noreferrer">
            {SITE.author}
          </a>{' '}
          ·{' '}
          <a href={SITE.repo} target="_blank" rel="noreferrer">
            source and lab scripts
          </a>
        </span>
        <span className="muted">Illustrative traces and simulated numbers. Not affiliated with any hardware vendor.</span>
      </footer>

      <Search open={searchOpen} onClose={() => setSearchOpen(false)} go={go} />
      <Assistant />
    </div>
  )
}

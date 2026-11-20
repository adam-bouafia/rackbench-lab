import { useEffect, useState } from 'react'

// Which lessons a viewer has finished. Kept in this browser only; if storage is blocked
// (private window, blocked site data) it falls back to memory for this visit.
const KEY = 'rackbench:done'
let memory: string[] = []
const listeners = new Set<() => void>()

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : memory
  } catch {
    return memory
  }
}

function write(ids: string[]) {
  memory = ids
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    /* memory only */
  }
  listeners.forEach((l) => l())
}

export function markDone(id: string) {
  const done = read()
  if (!done.includes(id)) write([...done, id])
}

export function resetProgress() {
  write([])
}

export function useDone(): string[] {
  const [done, setDone] = useState<string[]>(read)
  useEffect(() => {
    const l = () => setDone(read())
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return done
}

export function useStored<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback
    } catch {
      return fallback
    }
  })
  const set = (v: T) => {
    setValue(v)
    try {
      localStorage.setItem(key, v)
    } catch {
      /* ignore */
    }
  }
  return [value, set]
}

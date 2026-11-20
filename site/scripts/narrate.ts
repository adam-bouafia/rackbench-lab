// Narration MP3s for every step of the step-through lessons, made with ElevenLabs text to speech.
// The audio files are static assets: once generated, the site plays them without any key.
//
// From the site folder (Node 24 runs TypeScript directly):
//   node scripts/narrate.ts                 count characters and estimate credits; calls nothing
//   node scripts/narrate.ts --yes           generate the missing files into public/audio/
//   node scripts/narrate.ts --yes --only pxe
// Options: --model eleven_flash_v2_5 (default, about 0.5 credit per character)
//          --model eleven_multilingual_v2 (about 1 credit per character, a little more natural)
//          --voice <voice id> (default: a premade voice; list yours at https://elevenlabs.io/app/voice-library)
// Key: ELEVENLABS_API_KEY in the environment or in site/.env.local, which git ignores. Never commit it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOWS } from '../src/lessons/flows.ts'

const here = dirname(fileURLToPath(import.meta.url))
const site = join(here, '..')
const out = join(site, 'public', 'audio')

const args = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const yes = args.includes('--yes')
const only = opt('--only', '')
const model = opt('--model', 'eleven_flash_v2_5')
const voice = opt('--voice', 'JBFqnCBsd6RMkjVDRZzb')
const perChar = model.includes('flash') || model.includes('turbo') ? 0.5 : 1

function key(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  const env = join(site, '.env.local')
  if (existsSync(env)) {
    const line = readFileSync(env, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('ELEVENLABS_API_KEY='))
    if (line) return line.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

const speakable = (t: string) =>
  t
    .replace(/→/g, ' to ')
    .replace(/×/g, ' times ')
    .replace(/\bIPMI\b/g, 'I P M I')
    .replace(/\bSEL\b/g, 'S E L')
    .replace(/\s+/g, ' ')
    .trim()

const jobs: { lesson: string; n: number; text: string; file: string }[] = []
for (const [id, flow] of Object.entries(FLOWS)) {
  if (only && id !== only) continue
  flow.steps.forEach((s, i) => {
    const n = i + 1
    jobs.push({ lesson: id, n, text: speakable(`Step ${n}. ${s.summary}. ${s.explain.join(' ')}`), file: join(out, id, `${String(n).padStart(2, '0')}.mp3`) })
  })
}

const todo = jobs.filter((j) => !existsSync(j.file))
const chars = todo.reduce((a, j) => a + j.text.length, 0)
const byLesson = new Map<string, number>()
for (const j of todo) byLesson.set(j.lesson, (byLesson.get(j.lesson) ?? 0) + j.text.length)

console.log(`Model ${model}, voice ${voice}`)
for (const [id, c] of byLesson) console.log(`  ${id.padEnd(12)} ${String(c).padStart(6)} characters`)
console.log(`${todo.length} files to make (${jobs.length - todo.length} already exist), ${chars} characters, about ${Math.ceil(chars * perChar)} credits.`)

if (!yes) {
  console.log('Nothing generated. Run again with --yes to spend the credits.')
  process.exit(0)
}
const apiKey = key()
if (!apiKey) {
  console.error('No ELEVENLABS_API_KEY in the environment or in site/.env.local.')
  process.exit(1)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const j of todo) {
  mkdirSync(dirname(j.file), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: j.text, model_id: model }),
    })
    if (r.ok) {
      writeFileSync(j.file, Buffer.from(await r.arrayBuffer()))
      console.log(`  wrote ${j.lesson}/${String(j.n).padStart(2, '0')}.mp3`)
      break
    }
    const detail = (await r.text()).slice(0, 300)
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      console.log(`  ${r.status}, retrying in ${attempt * 5} s`)
      await sleep(attempt * 5000)
      continue
    }
    console.error(`Stopped at ${j.lesson} step ${j.n}: HTTP ${r.status} ${detail}`)
    process.exit(1)
  }
  await sleep(300)
}

// The manifest lists only lessons whose every step has a file, so the site never plays a gap.
const lessons: Record<string, number> = {}
for (const [id, flow] of Object.entries(FLOWS)) {
  const all = flow.steps.every((_, i) => existsSync(join(out, id, `${String(i + 1).padStart(2, '0')}.mp3`)))
  if (all) lessons[id] = flow.steps.length
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ model, voice, generated: new Date().toISOString().slice(0, 10), lessons }, null, 2) + '\n')
console.log(`manifest.json: ${Object.keys(lessons).length} lessons with narration`)

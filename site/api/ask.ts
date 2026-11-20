// POST /api/ask: the "Ask the rack" assistant of Rackbench Explorer.
// Runs as a Vercel Function. It calls a model through the Vercel AI Gateway (OpenAI-compatible API).
//
// Environment (set in the Vercel project settings, or in site/.env.local for `npm run dev`; never in git):
//   AI_GATEWAY_API_KEY   key created in the Vercel dashboard, AI Gateway tab (on Vercel deployments the
//                        project's OIDC token works as well, so the key can be left out there)
//   ASSISTANT_MODEL      optional, default anthropic/claude-haiku-5.5
//   ASSISTANT_DAILY_MAX  optional, answers per instance per day, default 300
//
// Protection for the credit: question and context length limits, a small max_tokens, and a per-IP
// limit kept in memory (best effort: each function instance has its own counters). Also set a spend
// limit for AI Gateway in the Vercel dashboard.

declare const process: { env: Record<string, string | undefined> }

const GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const PER_MINUTE = 6
const PER_DAY = 40

const SYSTEM = `You are the tutor of Rackbench Explorer, an interactive site that teaches how server racks are tested before they ship: BMCs, IPMI and Redfish, PXE and iPXE network boot, BIOS and BMC firmware updates, BOM checks, burn-in with stress-ng, fio and iperf3, bonds, VLANs and jumbo frames, the system event log, and fault isolation. The site's lab ("rackbench") is three Ubuntu VMs on KVM (rk-n1..rk-n3) with virtualbmc and sushy-tools as BMCs, OpenBMC in QEMU, an iPXE boot server and a fault injector (lab/faults.sh).

Answer the question in plain English, briefly (at most about 180 words), concretely, with the exact command or field name when it helps. Use plain text, no Markdown headings. If the question is outside servers, networking, Linux or testing, say that you only help with this site's topics. If you are not sure, say so rather than guessing. Never invent vendor-specific commands or options; say "check the vendor's guide" instead.`

const hits = new Map<string, number[]>()
let day = new Date().toISOString().slice(0, 10)
let todayCount = 0

function limited(ip: string): string | null {
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) {
    day = today
    todayCount = 0
    hits.clear()
  }
  const max = Number(process.env.ASSISTANT_DAILY_MAX ?? 300)
  if (todayCount >= max) return 'The assistant has answered enough questions for today. Try again tomorrow.'
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 24 * 3600_000)
  if (list.filter((t) => now - t < 60_000).length >= PER_MINUTE) return 'Too many questions in a minute. Wait a moment.'
  if (list.length >= PER_DAY) return 'You have reached the daily number of questions.'
  list.push(now)
  hits.set(ip, list)
  todayCount += 1
  return null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

interface Body {
  question?: unknown
  page?: unknown
  context?: unknown
  history?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const key = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN
  if (!key) return json({ error: 'The assistant is not configured on this deployment.' }, 503)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Bad request.' }, 400)
  }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 600) : ''
  if (!question) return json({ error: 'Ask a question.' }, 400)
  const page = typeof body.page === 'string' ? body.page.slice(0, 120) : ''
  const context = typeof body.context === 'string' ? body.context.slice(0, 3000) : ''
  const history = Array.isArray(body.history)
    ? (body.history as { role?: unknown; text?: unknown }[])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .slice(-4)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.text as string).slice(0, 1200) }))
    : []

  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()
  const stop = limited(ip)
  if (stop) return json({ error: stop }, 429)

  const messages = [
    { role: 'system', content: SYSTEM },
    ...history,
    { role: 'user', content: `The viewer is on: ${page || 'the site'}\n${context ? `What the page shows right now:\n${context}\n` : ''}\nQuestion: ${question}` },
  ]

  try {
    const r = await fetch(GATEWAY, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.ASSISTANT_MODEL ?? 'anthropic/claude-haiku-5.5', max_tokens: 450, temperature: 0.3, messages }),
    })
    if (!r.ok) return json({ error: `The model did not answer (${r.status}).` }, 502)
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const answer = data.choices?.[0]?.message?.content?.trim()
    if (!answer) return json({ error: 'The model returned no answer.' }, 502)
    return json({ answer })
  } catch {
    return json({ error: 'Could not reach the model.' }, 502)
  }
}

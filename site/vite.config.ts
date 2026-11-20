import { defineConfig, loadEnv, type Plugin } from 'vite'

// During `npm run dev`, serve /api/ask from site/api/ask.ts, so the assistant can be tried locally
// with AI_GATEWAY_API_KEY in site/.env.local. On Vercel the same file runs as a function.
function localApi(): Plugin {
  return {
    name: 'rackbench-local-api',
    configureServer(server) {
      server.middlewares.use('/api/ask', async (req, res) => {
        try {
          const mod = (await server.ssrLoadModule('/api/ask.ts')) as { POST: (r: Request) => Promise<Response> }
          const body = await new Promise<string>((resolve) => {
            let data = ''
            req.on('data', (c) => (data += c))
            req.on('end', () => resolve(data))
          })
          const request = new Request('http://localhost/api/ask', {
            method: req.method,
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': req.socket.remoteAddress ?? 'local' },
            body: req.method === 'POST' ? body : undefined,
          })
          const response = await mod.POST(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(await response.text())
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

// base './' keeps every asset path relative, so the same build works on Vercel, on GitHub Pages
// (adam-bouafia.github.io/rackbench/) and from any local folder.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const k of ['AI_GATEWAY_API_KEY', 'ASSISTANT_MODEL']) if (env[k]) process.env[k] = env[k]
  return {
    plugins: [localApi()],
    // JSX with the automatic runtime (React 17+), no plugin needed. Fast Refresh is not set up:
    // the dev server reloads the page on changes.
    esbuild: { jsx: 'automatic' },
    base: './',
  }
})

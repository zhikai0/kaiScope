import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import fs from 'fs'
import path from 'path'

// ── 拖拽文件上传 + 静态服务 ────────────────────────────────────────────
function urdfDropPlugin() {
  return {
    name: 'urdf-drop',
    configureServer(server) {
      const tmpDir = path.join(process.cwd(), '.urdf-temp')
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

      // 上传单个文件：POST /urdf-drop/<sessionId>/<path>  body=raw file bytes
      server.middlewares.use('/urdf-drop', (req, res) => {
        const url = decodeURIComponent(req.url)

        if (req.method === 'POST' && url.startsWith('/')) {
          // url = /<sessionId>/<path...>
          const segments = url.split('/').filter(Boolean)
          if (segments.length < 2) { res.writeHead(400); res.end('no session'); return }
          const sessionId = segments[0]
          const rel = segments.slice(1).join('/')
          const absPath = path.join(tmpDir, sessionId, rel)
          if (!absPath.startsWith(tmpDir)) { res.writeHead(403); res.end(); return }

          fs.mkdirSync(path.dirname(absPath), { recursive: true })
          const chunks = []
          req.on('data', c => chunks.push(c))
          req.on('end', () => {
            fs.writeFileSync(absPath, Buffer.concat(chunks))
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify({ ok: true, path: rel }))
          })
          return
        }

        // GET: 静态服务 /urdf-drop/<sessionId>/<path...>
        if (req.method === 'GET') {
          const segments = url.split('/').filter(Boolean)
          if (segments.length < 2) { res.writeHead(404); res.end(); return }
          const sessionId = segments[0]
          const rel = segments.slice(1).join('/')
          const abs = path.join(tmpDir, sessionId, rel)
          if (!abs.startsWith(tmpDir)) { res.writeHead(403); res.end(); return }
          if (!fs.existsSync(abs)) { res.writeHead(404); res.end(); return }
          const MIME = {
            '.dae':'model/vnd.collada+xml','.stl':'model/stl','.obj':'text/plain',
            '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
            '.urdf':'application/xml','.xml':'application/xml',
          }
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
          })
          fs.createReadStream(abs).pipe(res)
          return
        }

        res.writeHead(404); res.end()
      })

      server.middlewares.use('/urdf', (req, res) => {
        let abs
        const url = req.url.replace(/^\//, '')
        if (url.startsWith('file/')) {
          abs = decodeURIComponent(url.replace('file/', '/'))
        } else {
          const installBase = process.env.ROS_INSTALL_BASE || ''
          abs = path.join(installBase, url)
        }
        if (!fs.existsSync(abs)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end(`Not found: ${abs}`)
          return
        }
        const MIME = {
          '.dae':'model/vnd.collada+xml','.stl':'model/stl','.obj':'text/plain',
          '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
          '.urdf':'application/xml','.xml':'application/xml',
        }
        const ext = path.extname(abs).toLowerCase()
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        })
        fs.createReadStream(abs).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    urdfDropPlugin(),
  ],
  server: {
    host: '0.0.0.0',
    port: 8766,
  },
})
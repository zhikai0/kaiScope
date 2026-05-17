import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import fs from 'fs'
import path from 'path'

// ── URDF 文件代理插件 ─────────────────────────────────────────────────
function urdfFilePlugin() {
  return {
    name: 'urdf-file-proxy',
    configureServer(server) {
      server.middlewares.use('/urdf', (req, res) => {
        const installBase = '/home/zzk/workspace/wsl_ws/robot_ws/install/ackbot/share/ackbot/robots/salt_bot/assets'
        const relPath = req.url.replace(/^\//, '')
        const abs = path.join(installBase, relPath)

        if (!fs.existsSync(abs)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end(`Not found: ${abs}`)
          return
        }

        const MIME = {
          '.dae':  'model/vnd.collada+xml',
          '.stl':  'model/stl',
          '.obj':  'text/plain',
          '.png':  'image/png',
          '.jpg':  'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.urdf': 'application/xml',
          '.xml':  'application/xml',
        }
        const ext  = path.extname(abs).toLowerCase()
        const mime = MIME[ext] || 'application/octet-stream'

        res.writeHead(200, {
          'Content-Type': mime,
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
    urdfFilePlugin(),
  ],
  server: {
    host: '0.0.0.0',
    port: 8766,
  },
})

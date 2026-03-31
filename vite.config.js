import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import fs from 'fs'
import path from 'path'

// ── URDF 文件代理插件（内联，无需单独 node 服务） ──────────────────────
function urdfFilePlugin() {
  return {
    name: 'urdf-file-proxy',
    configureServer(server) {
      server.middlewares.use('/api/urdf/file', (req, res) => {
        const url    = new URL(req.url, 'http://localhost')
        const filePath = url.searchParams.get('path')
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing path parameter')
          return
        }
        const abs = path.resolve(filePath)
        if (!fs.existsSync(abs)) {
          console.warn(`[urdf] 404: ${abs}`)
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end(`File not found: ${abs}`)
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
        console.log(`[urdf] serve: ${abs}`)
        res.writeHead(200, {
          'Content-Type':                mime,
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
  build: {
    rollupOptions: {
      external: [
        '@foxglove/rosmsg',
        '@foxglove/rosmsg2-serialization',
      ],
    },
  },
})

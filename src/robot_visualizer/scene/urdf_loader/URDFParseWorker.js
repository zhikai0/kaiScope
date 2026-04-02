import { URDFParser } from './URDFParser.js'

self.onmessage = (e) => {
  try {
    const urdfText = e.data?.urdfText || ''
    const parsed = URDFParser.parse(urdfText)

    const payload = {
      name: parsed.name,
      links: Array.from(parsed.links.entries()),
      joints: Array.from(parsed.joints.entries()),
    }

    self.postMessage({ ok: true, data: payload })
  } catch (err) {
    self.postMessage({ ok: false, error: err?.message || String(err) })
  }
}

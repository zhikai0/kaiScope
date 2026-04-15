export function parseHexToBytes(hexText) {
  const cleaned = hexText.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length % 2 !== 0) {
    throw new Error('HEX 长度必须为偶数')
  }
  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < cleaned.length; i += 2) {
    out[i / 2] = Number.parseInt(cleaned.slice(i, i + 2), 16)
  }
  return out
}

export function parseLineToChannels(line, protocol, delimiter) {
  const s = line.trim()
  if (!s) return null

  const sep = protocol === 'csv' ? ',' : delimiter
  const parts = s.split(sep).map((x) => x.trim()).filter((x) => x.length > 0)
  if (parts.length === 0) return null

  const values = parts.map((p) => {
    const n = Number(p)
    return Number.isFinite(n) ? n : NaN
  })

  if (values.every((v) => !Number.isFinite(v))) return null
  return values
}

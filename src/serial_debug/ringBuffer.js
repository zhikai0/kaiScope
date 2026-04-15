const CAPACITY = 10000

export class RingSeries {
  constructor(capacity = CAPACITY) {
    this.capacity = capacity
    this.x = new Float64Array(capacity)
    this.ch = []
    this.channelCount = 0
    this.size = 0
    this.head = 0
  }

  _ensureChannels(n) {
    if (n <= this.channelCount) return
    for (let i = this.channelCount; i < n; i += 1) {
      const arr = new Float64Array(this.capacity)
      arr.fill(Number.NaN)
      this.ch.push(arr)
    }
    this.channelCount = n
  }

  push(t, values) {
    const n = Array.isArray(values) ? values.length : 0
    this._ensureChannels(n)

    this.x[this.head] = t
    for (let i = 0; i < this.channelCount; i += 1) {
      const v = i < n ? values[i] : Number.NaN
      this.ch[i][this.head] = Number.isFinite(v) ? v : Number.NaN
    }

    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) this.size += 1
  }

  snapshot() {
    const outX = new Array(this.size)
    const outCh = Array.from({ length: this.channelCount }, () => new Array(this.size))

    const start = (this.head - this.size + this.capacity) % this.capacity
    for (let i = 0; i < this.size; i += 1) {
      const idx = (start + i) % this.capacity
      outX[i] = this.x[idx]
      for (let c = 0; c < this.channelCount; c += 1) outCh[c][i] = this.ch[c][idx]
    }
    return [outX, ...outCh]
  }

  stats(enabledChannels) {
    const snap = this.snapshot()
    const count = Math.max(this.channelCount, enabledChannels.length)
    const ans = []
    for (let c = 0; c < count; c += 1) {
      if (!enabledChannels[c]) {
        ans.push({ min: '-', max: '-', avg: '-' })
        continue
      }
      const arr = snap[c + 1] || []
      let min = Infinity
      let max = -Infinity
      let sum = 0
      let n = 0
      for (let i = 0; i < arr.length; i += 1) {
        const v = arr[i]
        if (!Number.isFinite(v)) continue
        if (v < min) min = v
        if (v > max) max = v
        sum += v
        n += 1
      }
      if (n === 0) ans.push({ min: '-', max: '-', avg: '-' })
      else ans.push({ min: min.toFixed(3), max: max.toFixed(3), avg: (sum / n).toFixed(3) })
    }
    return ans
  }
}

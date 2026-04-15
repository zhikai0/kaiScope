import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const PALETTE = ['#1f7aed', '#00a07a', '#f28f2d', '#e84a5f', '#8a5cf6', '#00b8d9', '#ff6f61', '#7cb342']

export default function UPlotPanel({ series, enabledChannels }) {
  const wrapRef = useRef(null)
  const plotRef = useRef(null)
  const seriesCountRef = useRef(0)

  useEffect(() => {
    if (!wrapRef.current || plotRef.current) return

    plotRef.current = new uPlot({
      width: Math.max(320, wrapRef.current.clientWidth - 2),
      height: Math.max(220, wrapRef.current.clientHeight - 2),
      cursor: { drag: { x: true, y: true } },
      select: { show: true },
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [{ stroke: '#90a4c0' }, { stroke: '#90a4c0' }],
      series: [{ label: 't' }, { label: 'CH1', stroke: PALETTE[0], width: 1.8 }],
    }, [[], []], wrapRef.current)

    const onResize = () => {
      if (!plotRef.current || !wrapRef.current) return
      plotRef.current.setSize({
        width: Math.max(320, wrapRef.current.clientWidth - 2),
        height: Math.max(220, wrapRef.current.clientHeight - 2),
      })
    }

    const ro = new ResizeObserver(() => onResize())
    ro.observe(wrapRef.current)
    window.addEventListener('resize', onResize)
    requestAnimationFrame(onResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      plotRef.current?.destroy()
      plotRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!plotRef.current) return
    const t = setInterval(() => {
      const plot = plotRef.current
      if (!plot) return

      const data = series.snapshot()
      const chCount = Math.max(0, data.length - 1)
      if (chCount <= 0) return

      if (chCount !== seriesCountRef.current) {
        seriesCountRef.current = chCount
        const opts = {
          ...plot.opts,
          width: Math.max(320, (wrapRef.current?.clientWidth || 320) - 2),
          height: Math.max(220, (wrapRef.current?.clientHeight || 220) - 2),
          series: [
            { label: 't' },
            ...Array.from({ length: chCount }, (_, i) => ({
              label: `CH${i + 1}`,
              stroke: PALETTE[i % PALETTE.length],
              width: 1.8,
              show: enabledChannels[i] ?? true,
            })),
          ],
        }
        plot.destroy()
        plotRef.current = new uPlot(opts, data, wrapRef.current)
        return
      }

      const xArr = data[0]
      if (!xArr || xArr.length < 2) {
        plot.setData(data, false)
        return
      }

      const xScale = plot.scales.x
      const xMin = xScale?.min
      const xMax = xScale?.max

      let width = Number.isFinite(xMin) && Number.isFinite(xMax) ? (xMax - xMin) : NaN
      if (!Number.isFinite(width) || width <= 0) {
        const end = xArr[xArr.length - 1]
        const start = xArr[Math.max(0, xArr.length - 400)]
        width = Math.max(1e-3, end - start)
      }

      plot.setData(data, false)
      const end = xArr[xArr.length - 1]
      plot.setScale('x', { min: end - width, max: end })
    }, 80)
    return () => clearInterval(t)
  }, [series, enabledChannels])

  useEffect(() => {
    if (!plotRef.current) return
    const chCount = seriesCountRef.current
    for (let i = 0; i < chCount; i += 1) {
      plotRef.current.setSeries(i + 1, { show: enabledChannels[i] ?? true })
    }
  }, [enabledChannels])

  useEffect(() => {
    if (!plotRef.current) return

    const onDblClick = () => {
      if (!plotRef.current) return
      plotRef.current.setScale('x', { auto: true })
      plotRef.current.setScale('y', { auto: true })
      const data = series.snapshot()
      const xArr = data[0]
      if (xArr && xArr.length >= 2) {
        const end = xArr[xArr.length - 1]
        const start = xArr[Math.max(0, xArr.length - 400)]
        plotRef.current.setScale('x', { min: start, max: end })
      }
    }

    const onWheel = (e) => {
      const plot = plotRef.current
      const wrap = wrapRef.current
      if (!plot || !wrap) return
      e.preventDefault()

      const rect = wrap.getBoundingClientRect()
      const px = Math.min(Math.max(0, e.clientX - rect.left), rect.width)
      const py = Math.min(Math.max(0, e.clientY - rect.top), rect.height)

      const xScale = plot.scales.x
      const yScale = plot.scales.y
      if (xScale?.min == null || xScale?.max == null || yScale?.min == null || yScale?.max == null) return

      const zoomIn = e.deltaY < 0
      const k = zoomIn ? 0.9 : 1.1

      if (e.shiftKey) {
        const yRange = yScale.max - yScale.min
        const yCenter = yScale.max - (py / Math.max(1, rect.height)) * yRange
        const next = yRange * k
        plot.setScale('y', { min: yCenter - next / 2, max: yCenter + next / 2 })
      } else {
        const xRange = xScale.max - xScale.min
        const xCenter = xScale.min + (px / Math.max(1, rect.width)) * xRange
        const next = xRange * k
        plot.setScale('x', { min: xCenter - next / 2, max: xCenter + next / 2 })
      }

      requestAnimationFrame(() => {
        const p = plotRef.current
        if (!p) return
        const snap = series.snapshot()
        const x = snap[0]
        if (!x || x.length < 2) return
        const xr = p.scales.x
        const width = (xr?.max ?? 0) - (xr?.min ?? 0)
        if (!Number.isFinite(width) || width <= 0) return
        const end = x[x.length - 1]
        p.setData(snap, false)
        p.setScale('x', { min: end - width, max: end })
      })
    }

    const el = wrapRef.current
    el?.addEventListener('dblclick', onDblClick)
    el?.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el?.removeEventListener('dblclick', onDblClick)
      el?.removeEventListener('wheel', onWheel)
    }
  }, [series])

  return <div className="sd-plot-box" ref={wrapRef} style={{ height: '100%' }} />
}

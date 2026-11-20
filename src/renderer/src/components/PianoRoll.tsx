import { useEffect, useMemo, useRef, useState } from 'react'
import { DRUM_SOUNDS, midiToPitch, pitchToMidi, STEPS_PER_BAR, type Note, type Track } from '@shared/song'
import { colorFor } from '../lib/colors'

interface Props {
  track: Track
  bars: number
  playStep: number
  compact?: boolean
  onChange?: (notes: Note[]) => void
  onPreview?: (note: Note) => void
}

const DEFAULT_RANGE: Record<string, [number, number]> = {
  bass: [28, 52],
  keys: [48, 72],
  pad: [48, 72],
  lead: [60, 84],
  pluck: [60, 84]
}

const LABEL_W = 44
const BLACK = new Set([1, 3, 6, 8, 10])

function rowsFor(track: Track): string[] {
  if (track.instrument === 'drums') return [...DRUM_SOUNDS].reverse()
  const [dLo, dHi] = DEFAULT_RANGE[track.instrument] ?? [48, 72]
  const midis = track.notes.map((n) => pitchToMidi(n.pitch)).filter((m): m is number => m !== null)
  let lo = Math.min(dLo, ...midis.map((m) => m - 2))
  let hi = Math.max(dHi, ...midis.map((m) => m + 2))
  lo = Math.max(0, lo)
  hi = Math.min(127, hi)
  const rows: string[] = []
  for (let m = hi; m >= lo; m--) rows.push(midiToPitch(m))
  return rows
}

/** Canonical form so "Db4" and "C#4" land on the same row. */
const canon = (pitch: string, drums: boolean) => {
  if (drums) return pitch
  const m = pitchToMidi(pitch)
  return m === null ? pitch : midiToPitch(m)
}

export function PianoRoll({ track, bars, playStep, compact, onChange, onPreview }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(800)
  const drag = useRef<{ note: Note; originStep: number } | null>(null)
  const [draft, setDraft] = useState<Note[] | null>(null)

  const drums = track.instrument === 'drums'
  const rows = useMemo(() => rowsFor(track), [track])
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r, i])), [rows])
  const totalSteps = bars * STEPS_PER_BAR
  const rowH = compact ? Math.max(2, Math.min(6, 56 / rows.length)) : drums ? 22 : 14
  const height = compact ? 56 : rows.length * rowH
  const labelW = compact ? 0 : LABEL_W
  const stepW = (width - labelW) / totalSteps
  const notes = draft ?? track.notes
  const color = colorFor(track.instrument)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = height * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)

    // Row backgrounds
    rows.forEach((r, i) => {
      const midi = drums ? null : pitchToMidi(r)
      const isBlack = midi !== null && BLACK.has(midi % 12)
      g.fillStyle = compact ? 'transparent' : isBlack ? '#14171d' : '#1a1e26'
      g.fillRect(labelW, i * rowH, width - labelW, rowH)
      if (!compact) {
        g.fillStyle = isBlack ? '#20242c' : '#2a2f3a'
        g.fillRect(0, i * rowH, labelW - 1, rowH - 1)
        if (drums || r.startsWith('C') && !r.startsWith('C#')) {
          g.fillStyle = '#8b93a7'
          g.font = '10px ui-monospace, monospace'
          g.textBaseline = 'middle'
          g.fillText(r, 6, i * rowH + rowH / 2)
        }
      }
    })

    // Grid
    if (!compact) {
      for (let s = 0; s <= totalSteps; s++) {
        const x = labelW + s * stepW
        g.fillStyle = s % STEPS_PER_BAR === 0 ? '#3b4252' : s % 4 === 0 ? '#2b303b' : '#1f232b'
        g.fillRect(Math.round(x), 0, 1, height)
      }
      g.fillStyle = '#1f232b'
      for (let i = 0; i <= rows.length; i++) g.fillRect(labelW, i * rowH, width - labelW, 1)
    }

    // Playhead
    if (playStep >= 0 && playStep < totalSteps) {
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fillRect(labelW + playStep * stepW, 0, stepW, height)
    }

    // Notes
    for (const n of notes) {
      const r = rowIndex.get(canon(n.pitch, drums))
      if (r === undefined) continue
      const x = labelW + n.start * stepW
      const w = Math.max(2, n.length * stepW - 1)
      const active = playStep >= n.start && playStep < n.start + n.length
      g.globalAlpha = 0.35 + 0.65 * n.velocity
      g.fillStyle = active ? '#ffffff' : color
      const y = r * rowH + (compact ? 0 : 1)
      const h = Math.max(1.5, rowH - (compact ? 0.5 : 2))
      if (compact) g.fillRect(x, y, w, h)
      else {
        g.beginPath()
        g.roundRect(x + 0.5, y, w, h, 3)
        g.fill()
      }
      g.globalAlpha = 1
    }
  }, [width, height, rows, rowIndex, rowH, labelW, stepW, totalSteps, notes, playStep, drums, compact, color])

  if (compact) {
    return (
      <div ref={wrap} className="roll compact">
        <canvas ref={canvas} style={{ width, height }} />
      </div>
    )
  }

  const cellAt = (e: React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - labelW
    const y = e.clientY - rect.top
    return { step: Math.floor(x / stepW), row: Math.floor(y / rowH) }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (!onChange) return
    const { step, row } = cellAt(e)
    if (step < 0 || step >= totalSteps || row < 0 || row >= rows.length) return
    const pitch = rows[row]
    const hit = track.notes.find(
      (n) => canon(n.pitch, drums) === pitch && step >= n.start && step < n.start + n.length
    )
    if (hit || e.button === 2) {
      if (hit) onChange(track.notes.filter((n) => n !== hit))
      return
    }
    const note: Note = { pitch, start: step, length: drums ? 1 : 2, velocity: 0.8 }
    note.length = Math.min(note.length, totalSteps - step)
    drag.current = { note, originStep: step }
    setDraft([...track.notes, note])
    onPreview?.(note)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d || drums) return
    const { step } = cellAt(e)
    const length = Math.max(1, Math.min(totalSteps - d.originStep, step - d.originStep + 1))
    if (length !== d.note.length) {
      d.note = { ...d.note, length }
      setDraft([...track.notes, d.note])
    }
  }

  const finish = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setDraft(null)
    onChange?.([...track.notes, d.note].sort((a, b) => a.start - b.start))
  }

  return (
    <div ref={wrap} className="roll">
      <canvas
        ref={canvas}
        style={{ width, height, cursor: 'crosshair' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={finish}
        onMouseLeave={finish}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}

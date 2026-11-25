import { useEffect, useMemo, useRef, useState } from 'react'
import { STEPS_PER_BAR, VOICES, type TuneSettings, type VocalTake, type VoiceId } from '@shared/song'
import { VOICE_PRESETS } from '@shared/vocals/sing'
import type { VocalAudio } from '../lib/engine'

interface Props {
  take: VocalTake
  audio: VocalAudio | undefined
  bars: number
  bpm: number
  playStep: number
  selected: boolean
  soloed: boolean
  hasMelody: boolean
  busy: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<VocalTake>, record?: boolean) => void
  onTune: (tune: TuneSettings) => void
  onRevoice: (voice: VoiceId) => void
  onDelete: () => void
  onSolo: () => void
}

const VOCAL_COLOR = '#ff8a5c'

/** Peak per pixel column, for drawing the waveform. */
function peaks(data: Float32Array, columns: number): Float32Array {
  const out = new Float32Array(columns)
  const per = Math.max(1, Math.floor(data.length / columns))
  for (let c = 0; c < columns; c++) {
    let m = 0
    const o = c * per
    for (let i = 0; i < per && o + i < data.length; i += 4) m = Math.max(m, Math.abs(data[o + i]))
    out[c] = m
  }
  return out
}

function Waveform({ take, audio, bars, bpm, playStep, height }: Pick<Props, 'take' | 'audio' | 'bars' | 'bpm' | 'playStep'> & { height: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(800)
  const total = bars * STEPS_PER_BAR
  const loopSec = (total * 60) / bpm / 4

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(100, el.clientWidth - 20)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const x0 = (take.start / total) * width
  const visibleSec = Math.min(take.duration, loopSec * (1 - take.start / total))
  const w = (visibleSec / loopSec) * width
  const cols = useMemo(() => {
    if (!audio) return null
    const shown = audio.data.subarray(0, Math.round(visibleSec * audio.sampleRate))
    return peaks(shown, Math.max(1, Math.round(w)))
  }, [audio, w, visibleSec])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = height * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, width, height)
    // Bar lines.
    g.strokeStyle = 'rgba(255,255,255,0.06)'
    for (let b = 1; b < bars; b++) {
      const x = Math.round((b / bars) * width) + 0.5
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, height)
      g.stroke()
    }
    g.fillStyle = 'rgba(255,138,92,0.12)'
    g.fillRect(x0, 0, w, height)
    if (cols) {
      g.fillStyle = VOCAL_COLOR
      const mid = height / 2
      let max = 0
      for (const v of cols) max = Math.max(max, v)
      const scale = max > 0 ? (height * 0.46) / max : 0
      for (let i = 0; i < cols.length; i++) {
        const h = Math.max(0.5, cols[i] * scale)
        g.fillRect(x0 + i, mid - h, 1, h * 2)
      }
    }
    if (playStep >= 0) {
      g.fillStyle = 'rgba(255,255,255,0.7)'
      g.fillRect(Math.round((playStep / total) * width), 0, 1, height)
    }
  }, [width, height, bars, cols, x0, w, playStep, total])

  return (
    <div ref={wrap} className="roll compact wave">
      <canvas ref={canvas} style={{ width, height }} />
      {!audio && <span className="wave-missing">Audio not found in this browser</span>}
    </div>
  )
}

export function VocalRow(props: Props) {
  const { take, selected, soloed, hasMelody, busy } = props
  const tune = take.tune
  const setTune = (patch: Partial<TuneSettings>) => props.onTune({ ...tune, ...patch })
  const label =
    take.kind === 'generated'
      ? `Sung by ${VOICE_PRESETS[take.voice ?? 'aria'].label.split(' (')[0]}`
      : tune.on
        ? 'Your voice · autotuned'
        : 'Your voice'

  return (
    <div className={`track vocal${selected ? ' selected' : ''}${take.muted ? ' muted' : ''}`}>
      <div className="track-head" onClick={props.onSelect}>
        <span className="swatch" style={{ background: VOCAL_COLOR }} />
        <input className="track-name" value={take.name} onClick={(e) => e.stopPropagation()} onChange={(e) => props.onUpdate({ name: e.target.value }, false)} />
        <span className="badge">{busy ? 'Processing…' : label}</span>
        <div className="track-buttons" onClick={(e) => e.stopPropagation()}>
          {take.kind === 'recorded' && (
            <button className={`toggle${tune.on ? ' on' : ''}`} title={tune.on ? 'Autotune on' : 'Autotune off'} onClick={() => setTune({ on: !tune.on })}>
              Tune
            </button>
          )}
          <button className={`toggle${take.muted ? ' on' : ''}`} title="Mute" onClick={() => props.onUpdate({ muted: !take.muted })}>M</button>
          <button className={`toggle solo${soloed ? ' on' : ''}`} title="Solo" onClick={props.onSolo}>S</button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={take.volume}
            title={`Volume ${Math.round(take.volume * 100)}%`}
            onChange={(e) => props.onUpdate({ volume: parseFloat(e.target.value) }, false)}
          />
          <button className="icon" title="Delete take" onClick={props.onDelete}>✕</button>
        </div>
      </div>
      {selected && (
        <div className="vocal-settings">
          {take.kind === 'recorded' ? (
            <>
              <label className="check">
                <input type="checkbox" checked={tune.on} onChange={(e) => setTune({ on: e.target.checked })} /> Autotune
              </label>
              <label className="field" title="How far each note is pulled onto the right pitch">
                Strength
                <input type="range" min={0} max={1} step={0.05} value={tune.strength} disabled={!tune.on} onChange={(e) => setTune({ strength: parseFloat(e.target.value) })} />
              </label>
              <label className="field" title="Left: hard, robotic snap. Right: smooth and natural.">
                Robotic
                <input type="range" min={0} max={0.25} step={0.01} value={tune.speed} disabled={!tune.on} onChange={(e) => setTune({ speed: parseFloat(e.target.value) })} />
                Natural
              </label>
              <label className="check" title={hasMelody ? 'Pull to the notes of the Vocal track' : 'Add a Vocal track to follow its melody'}>
                <input type="checkbox" checked={tune.followMelody && hasMelody} disabled={!tune.on || !hasMelody} onChange={(e) => setTune({ followMelody: e.target.checked })} />
                Follow the Vocal melody
              </label>
            </>
          ) : (
            <>
              <span className="muted">Voice</span>
              <div className="seg">
                {VOICES.map((v) => (
                  <button key={v} className={take.voice === v ? 'on' : ''} disabled={busy} onClick={() => props.onRevoice(v)}>
                    {VOICE_PRESETS[v].label.split(' (')[0]}
                  </button>
                ))}
              </div>
              <button disabled={busy} onClick={() => props.onRevoice(take.voice ?? 'aria')} title="Sing it again on the current melody and tempo">
                ↻ Re-sing
              </button>
            </>
          )}
        </div>
      )}
      <div onClick={props.onSelect}>
        <Waveform take={take} audio={props.audio} bars={props.bars} bpm={props.bpm} playStep={props.playStep} height={56} />
      </div>
    </div>
  )
}

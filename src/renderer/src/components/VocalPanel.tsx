import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { STEPS_PER_BAR, VOICES, type Song, type VoiceId } from '@shared/song'
import { VOICE_PRESETS } from '@shared/vocals/sing'
import { vocalMelody } from '@shared/vocals/tune'
import type { Engine } from '../lib/engine'
import { MicRecorder, outputLatency } from '../lib/recorder'

type Phase = 'idle' | 'opening' | 'countin' | 'recording' | 'processing'

interface Props {
  song: Song
  engine: Engine | null
  /** Status of a vocal job running in the app (generating, tuning). */
  working: string
  canCompose: boolean
  composing: boolean
  onStarted: () => void
  onTake: (samples: Float32Array, sampleRate: number) => Promise<void>
  onGenerate: (voice: VoiceId) => void
  onWriteMelody: (voice: VoiceId) => void
  onWriteLyrics: () => void
  onCancel: () => void
  onClose: () => void
}

const firstLine = (lyrics: string) =>
  lyrics
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^\[.*\]$/.test(l)) ?? ''

export function VocalPanel(props: Props) {
  const { song, engine, working, canCompose, composing } = props
  const [phase, setPhase] = useState<Phase>('idle')
  const [beat, setBeat] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState('')
  const [voice, setVoice] = useState<VoiceId>('aria')
  const rec = useRef<MicRecorder | null>(null)
  const stopAt = useRef<number | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current)
      rec.current?.close()
    },
    []
  )

  const melody = vocalMelody(song)
  const hasLyrics = song.lyrics.trim().length > 0
  const loopSec = (song.bars * STEPS_PER_BAR * 60) / song.bpm / 4

  const record = async () => {
    if (!engine) return
    setError('')
    setPhase('opening')
    const r = (rec.current ??= new MicRecorder())
    r.onLevel = setLevel
    try {
      await r.open()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('idle')
      return
    }
    const ctx = Tone.getContext()
    const beatSec = 60 / song.bpm
    const t0 = ctx.currentTime + 0.2
    // One bar of count-in clicks, then the loop starts from the top.
    const click = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).toDestination()
    click.volume.value = -8
    for (let i = 0; i < 4; i++) click.triggerAttackRelease(i === 0 ? 'C5' : 'G4', '32n', t0 + i * beatSec)
    window.setTimeout(() => click.dispose(), (0.4 + 4 * beatSec) * 1000)
    const start = t0 + 4 * beatSec
    await engine.play(start)
    props.onStarted()
    const lag = outputLatency() + r.inputLatency()
    const from = start + lag
    stopAt.current = from + loopSec
    setPhase('countin')
    timer.current = window.setInterval(async () => {
      const now = ctx.currentTime
      if (now < start) {
        setBeat(Math.min(4, Math.floor((now - t0) / beatSec) + 1))
        return
      }
      setPhase((p) => (p === 'countin' ? 'recording' : p))
      if (r.capturedUntil() < (stopAt.current ?? 0)) return
      window.clearInterval(timer.current!)
      timer.current = null
      const samples = r.slice(from, stopAt.current!)
      let energy = 0
      for (let i = 0; i < samples.length; i += 16) energy = Math.max(energy, Math.abs(samples[i]))
      if (samples.length < r.sampleRate * 0.3 || energy < 0.01) {
        setError("I didn't hear anything. Check that the right microphone is picked in your browser, then try again.")
        setPhase('idle')
        return
      }
      setPhase('processing')
      try {
        await props.onTake(samples, r.sampleRate)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      setPhase('idle')
    }, 40)
  }

  /** Stop early: keep what was sung so far. */
  const stopEarly = () => {
    if (phase === 'countin') {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
      setPhase('idle')
      return
    }
    stopAt.current = Math.min(stopAt.current ?? 0, Tone.getContext().currentTime)
  }

  const recordingNow = phase === 'countin' || phase === 'recording' || phase === 'opening'

  return (
    <div className="vocal-panel">
      <div className="vocal-head">
        <strong>🎤 Vocals</strong>
        <span className="muted">Sing over your loop, or have Claude sing your lyrics.</span>
        <span className="spacer" />
        <button className="icon" onClick={props.onClose} title="Close">✕</button>
      </div>
      <div className="vocal-cards">
        <section className="vocal-card">
          <h3>Sing it yourself</h3>
          <p className="muted">
            Records one pass of the loop ({loopSec.toFixed(1)}s) after a one-bar count-in, then autotunes it to
            {melody.length ? ' your Vocal melody' : ` ${song.key}`}. Headphones sound best.
          </p>
          <div className="vocal-row-controls">
            {recordingNow ? (
              <button className="rec on" onClick={stopEarly}>
                ■ {phase === 'opening' ? 'Opening mic…' : phase === 'countin' ? `Count-in ${beat || 1}/4` : 'Recording… stop'}
              </button>
            ) : (
              <button className="rec" disabled={phase === 'processing' || !song.tracks.length} onClick={record}>
                {phase === 'processing' ? 'Autotuning…' : '● Record a take'}
              </button>
            )}
            <div className="meter" title="Microphone level">
              <div style={{ width: `${Math.round((rec.current ? level : 0) * 100)}%` }} />
            </div>
          </div>
          {!song.tracks.length && <p className="muted small">Make a beat first, so there's something to sing over.</p>}
        </section>

        <section className="vocal-card">
          <h3>Have Claude sing it</h3>
          <div className="seg voices">
            {VOICES.map((v) => (
              <button key={v} className={voice === v ? 'on' : ''} onClick={() => setVoice(v)} title={VOICE_PRESETS[v].label}>
                {VOICE_PRESETS[v].label.split(' (')[0]}
              </button>
            ))}
          </div>
          {!hasLyrics ? (
            <>
              <p className="muted">Claude sings your lyrics on the Vocal melody. Write some lyrics first.</p>
              <button onClick={props.onWriteLyrics}>✍️ Write lyrics</button>
            </>
          ) : !melody.length ? (
            <>
              <p className="muted">Sings “{firstLine(song.lyrics)}…” Claude writes a Vocal melody for it first.</p>
              <button className="primary" disabled={composing || !!working} onClick={() => props.onWriteMelody(voice)}>
                {composing ? 'Writing the melody…' : '✨ Write a melody and sing it'}
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                Sings your lyrics on the Vocal track ({melody.length} notes){canCompose ? '' : '. Add your API key for clearer words'}.
              </p>
              <button className="primary" disabled={!!working || composing} onClick={() => props.onGenerate(voice)}>
                ✨ Sing it
              </button>
            </>
          )}
        </section>
      </div>
      {(working || error) && (
        <div className={`vocal-status${error ? ' error-text' : ''}`}>
          {working ? (
            <>
              <span className="spinner" /> {working}
              <button className="link" onClick={props.onCancel}>Cancel</button>
            </>
          ) : (
            error
          )}
        </div>
      )}
    </div>
  )
}

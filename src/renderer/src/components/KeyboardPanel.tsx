import { useEffect, useRef, useState } from 'react'
import { DRUM_SOUNDS, midiToPitch, STEPS_PER_BAR, type Note, type Song, type Track } from '@shared/song'
import { isBassRole, isDrumKit } from '@shared/instruments'
import { CHORD_KEYS, diatonicChord, KEY_LABEL, keyboardChord, noteName, parseKey, PIANO_KEYS, romanFor } from '@shared/theory'
import type { Engine } from '../lib/engine'

export type KeyMode = 'notes' | 'chords'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'password', 'email', 'url', 'tel'])

/** True only where letters should type text. Sliders, buttons, checkboxes and dropdowns don't count. */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  const h = el as HTMLElement
  if (h.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)
}

interface Props {
  song: Song
  target: Track | null
  engine: Engine | null
  playing: boolean
  recording: boolean
  busy: boolean
  canCompose: boolean
  onToggleRecord: () => void
  onRecordNotes: (trackId: string, notes: Note[]) => void
  onClear: (trackId: string) => void
  onBuildBand: () => void
  onClose: () => void
}

const HOME_ROW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote']
const TOP_ROW: (string | null)[] = ['KeyW', 'KeyE', null, 'KeyT', 'KeyY', 'KeyU', null, 'KeyO', 'KeyP', null]

interface Held {
  pitches: string[]
  /** The track the notes went to, so a release reaches it even if the selection changed. */
  trackId: string
  startPos: number
}

/**
 * Turns the laptop keyboard into an instrument. Home row = white keys (or
 * diatonic chords in chord mode), row above = black keys. While recording,
 * notes are quantised to the 16th grid of the loop and written to the target
 * track.
 */
const diatonicRoot = (scale: ReturnType<typeof parseKey>, degree: number, baseMidi: number) =>
  diatonicChord(scale, degree % 7, baseMidi)[0]

export function KeyboardPanel(props: Props) {
  const { song, target, playing, recording, busy, canCompose } = props
  const [mode, setMode] = useState<KeyMode>('chords')
  const [octave, setOctave] = useState(4)
  const [held, setHeld] = useState<Record<string, Held>>({})
  const [typing, setTyping] = useState(() => isTextEntry(document.activeElement))
  const heldRef = useRef<Record<string, Held>>({})
  const latest = useRef(props)
  latest.current = props
  const settings = useRef({ mode, octave })
  settings.current = { mode, octave }

  const scale = parseKey(song.key)
  const drums = !!target && isDrumKit(target.instrument)

  const pitchesFor = (code: string): string[] | null => {
    const { mode, octave } = settings.current
    const t = latest.current.target
    if (t && isDrumKit(t.instrument)) {
      const i = HOME_ROW.indexOf(code)
      return i >= 0 && i < DRUM_SOUNDS.length ? [DRUM_SOUNDS[i]] : null
    }
    if (mode === 'chords') {
      const degree = CHORD_KEYS[code]
      if (degree === undefined) return null
      const chord = keyboardChord(parseKey(latest.current.song.key), degree, (octave + 1) * 12)
      // Bass is one note at a time: play the chord's root an octave down.
      if (t && isBassRole(t.instrument)) {
        const root = diatonicRoot(parseKey(latest.current.song.key), degree, octave * 12)
        return [root]
      }
      return chord
    }
    const semis = PIANO_KEYS[code]
    if (semis === undefined) return null
    return [midiToPitch((octave + 1) * 12 + semis)]
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // While Cmd is down, macOS never sends keyup for other keys, so anything
      // held now could never be released. Let go of it up front.
      if (e.key === 'Meta') return releaseAll()
      if (isTextEntry(e.target as Element) || e.metaKey || e.ctrlKey || e.altKey) return
      // A focused dropdown would otherwise jump to the option starting with that letter.
      if ((e.target as Element).tagName === 'SELECT') (e.target as HTMLElement).blur()
      const p = latest.current
      if (e.code === 'KeyZ') return setOctave((o) => Math.max(1, o - 1))
      if (e.code === 'KeyX') return setOctave((o) => Math.min(7, o + 1))
      if (e.code === 'KeyC') return setMode((m) => (m === 'notes' ? 'chords' : 'notes'))
      if (e.code === 'KeyR') {
        e.preventDefault()
        if (!e.repeat) p.onToggleRecord()
        return
      }
      const pitches = pitchesFor(e.code)
      if (!pitches || !p.target) return
      e.preventDefault()
      if (e.repeat || heldRef.current[e.code]) return
      const startPos = p.engine?.position() ?? -1
      for (const pitch of pitches) p.engine?.noteOn(p.target.id, pitch, 0.8)
      heldRef.current = { ...heldRef.current, [e.code]: { pitches, trackId: p.target.id, startPos } }
      setHeld(heldRef.current)
    }

    const up = (e: KeyboardEvent) => {
      const h = heldRef.current[e.code]
      if (!h) return
      const { [e.code]: _, ...rest } = heldRef.current
      heldRef.current = rest
      setHeld(rest)
      const p = latest.current
      for (const pitch of h.pitches) p.engine?.noteOff(h.trackId, pitch)
      if (!p.recording || h.startPos < 0) return
      const total = p.song.bars * STEPS_PER_BAR
      const endPos = p.engine?.position() ?? h.startPos
      let len = endPos - h.startPos
      if (len < 0) len += total
      const start = Math.round(h.startPos) % total
      const length = Math.max(1, Math.min(total - start, Math.round(len)))
      const track = p.song.tracks.find((t) => t.id === h.trackId)
      if (!track) return
      p.onRecordNotes(
        track.id,
        h.pitches.map((pitch) => ({ pitch, start, length: isDrumKit(track.instrument) ? 1 : length, velocity: 0.8 }))
      )
    }

    // Let go of every held key. Used when keyups can't be trusted to arrive:
    // the window or tab loses focus, or Cmd goes down.
    const releaseAll = () => {
      const p = latest.current
      for (const h of Object.values(heldRef.current)) for (const pitch of h.pitches) p.engine?.noteOff(h.trackId, pitch)
      heldRef.current = {}
      setHeld({})
      p.engine?.allNotesOff()
    }
    const blur = releaseAll
    const hidden = () => {
      if (document.visibilityState === 'hidden') releaseAll()
    }

    const focusChange = () => setTyping(isTextEntry(document.activeElement))
    // On focusout, activeElement is only updated after the event.
    const focusOut = () => setTimeout(focusChange)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('focusin', focusChange)
    document.addEventListener('focusout', focusOut)
    return () => {
      document.removeEventListener('focusin', focusChange)
      document.removeEventListener('focusout', focusOut)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', hidden)
      releaseAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isHeld = (code: string) => !!held[code]

  const whiteLabel = (code: string, i: number): string => {
    if (drums) return DRUM_SOUNDS[i] ?? ''
    if (mode === 'chords') {
      const d = CHORD_KEYS[code]
      if (d === undefined) return ''
      const root = (scale.tonic + scale.steps[d % 7]) % 12
      return `${romanFor(scale, d % 7)} · ${noteName(root, scale)}`
    }
    return midiToPitch((octave + 1) * 12 + PIANO_KEYS[code])
  }

  const showBlack = !drums && mode === 'notes'
  const playedNotes = target?.notes.length ?? 0

  return (
    <div className="kbd-panel">
      <div className="kbd-controls">
        <div className="seg">
          <button className={mode === 'chords' ? 'on' : ''} disabled={drums} onClick={() => setMode('chords')}>Chords</button>
          <button className={mode === 'notes' ? 'on' : ''} disabled={drums} onClick={() => setMode('notes')}>Notes</button>
        </div>
        {!drums && (
          <div className="octave">
            <button onClick={() => setOctave((o) => Math.max(1, o - 1))} title="Octave down (Z)">−</button>
            <span>Oct {octave}</span>
            <button onClick={() => setOctave((o) => Math.min(7, o + 1))} title="Octave up (X)">+</button>
          </div>
        )}
        <span className="kbd-target">
          → <strong>{target?.name ?? 'no track'}</strong> <span className="muted">in {scale.name}</span>
        </span>
        <span className="spacer" />
        <button className={`rec${recording ? ' on' : ''}`} onClick={props.onToggleRecord} title="Record (R)">
          <span className="rec-dot" /> {recording ? (playing ? 'Recording' : 'Armed') : 'Record'}
        </button>
        {target && playedNotes > 0 && (
          <button onClick={() => props.onClear(target.id)} title="Remove every note from this track">Clear</button>
        )}
        <button
          className="primary"
          disabled={busy || !canCompose || !target || playedNotes === 0}
          onClick={props.onBuildBand}
          title={!canCompose ? 'Add an API key in Settings' : 'Claude writes drums, bass and more around your part'}
        >
          ✦ Build the band around this
        </button>
        <button className="icon" onClick={props.onClose} title="Close keyboard (`)">✕</button>
      </div>

      <div className="kbd">
        {showBlack && <div className="kbd-row top">
          {TOP_ROW.map((code, i) =>
            code && showBlack ? (
              <div key={code} className={`key black${isHeld(code) ? ' down' : ''}`}>
                <span className="cap">{KEY_LABEL[code]}</span>
                <span className="lbl">{midiToPitch((octave + 1) * 12 + PIANO_KEYS[code])}</span>
              </div>
            ) : (
              <div key={`gap${i}`} className="key gap" />
            )
          )}
        </div>}
        <div className="kbd-row">
          {HOME_ROW.map((code, i) => {
            const label = whiteLabel(code, i)
            const active = label !== ''
            return (
              <div key={code} className={`key white${isHeld(code) ? ' down' : ''}${active ? '' : ' off'}`}>
                <span className="cap">{KEY_LABEL[code]}</span>
                <span className="lbl">{label}</span>
              </div>
            )
          })}
        </div>
      </div>
      {typing && (
        <div className="kbd-typing">
          ⌨ You're typing in a text box, so keys go there. Click an empty spot (or press Esc) to play.
        </div>
      )}
      <div className="kbd-help">
        {drums
          ? 'Home row plays drums. '
          : mode === 'chords'
            ? 'Home row plays chords in the song key. '
            : 'Home row = white keys, row above = black keys. '}
        Z/X octave · C chords/notes · R record · ` close. Notes snap to the 16th grid while recording.
      </div>
    </div>
  )
}

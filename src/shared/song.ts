// The song model shared by the main process (Claude composes it) and the
// renderer (plays and edits it). Time is measured in 16th-note steps.

export const STEPS_PER_BAR = 16

export const INSTRUMENTS = ['drums', 'bass', 'lead', 'pad', 'pluck', 'keys'] as const
export type Instrument = (typeof INSTRUMENTS)[number]

export const DRUM_SOUNDS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'tom', 'rim'] as const
export type DrumSound = (typeof DRUM_SOUNDS)[number]

export interface Note {
  /** Scientific pitch like "C4" / "F#2", or a DrumSound on drum tracks. */
  pitch: string
  /** Start position in 16th steps from the start of the loop. */
  start: number
  /** Length in 16th steps. */
  length: number
  /** 0..1 */
  velocity: number
}

export interface Track {
  id: string
  name: string
  instrument: Instrument
  /** 0..1 */
  volume: number
  muted: boolean
  notes: Note[]
}

export interface Song {
  title: string
  bpm: number
  key: string
  bars: number
  /** 0..0.5 — delays every other 16th for groove. */
  swing: number
  tracks: Track[]
}

export function emptySong(): Song {
  return { title: 'Untitled', bpm: 100, key: 'C minor', bars: 2, swing: 0, tracks: [] }
}

// ---------------------------------------------------------------------------
// Pitch helpers
// ---------------------------------------------------------------------------

const NOTE_INDEX: Record<string, number> = {
  C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6,
  G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11
}
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "C4" -> 60. Returns null for anything that isn't a pitch. */
export function pitchToMidi(pitch: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(pitch.trim())
  if (!m) return null
  const name = (m[1] + m[2]).toUpperCase()
  const idx = NOTE_INDEX[name]
  if (idx === undefined) return null
  return (parseInt(m[3], 10) + 1) * 12 + idx
}

export function midiToPitch(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

// ---------------------------------------------------------------------------
// Validation / normalisation — anything coming from the model or a file goes
// through here so the renderer can trust the shape.
// ---------------------------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

let idCounter = 0
export const newId = () => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`

export function normalizeSong(raw: unknown): Song {
  const r = (raw ?? {}) as Record<string, unknown>
  const bars = clamp(Math.round(num(r.bars, 2)), 1, 16)
  const totalSteps = bars * STEPS_PER_BAR
  const tracksRaw = Array.isArray(r.tracks) ? r.tracks : []

  const tracks: Track[] = tracksRaw.slice(0, 12).map((t) => {
    const tr = (t ?? {}) as Record<string, unknown>
    const instrument = (INSTRUMENTS as readonly string[]).includes(tr.instrument as string)
      ? (tr.instrument as Instrument)
      : 'keys'
    const notesRaw = Array.isArray(tr.notes) ? tr.notes : []
    const notes: Note[] = []
    // Monophonic voices (drum hits, bass) can't fire twice at the same instant.
    const seen = new Set<string>()
    for (const n of notesRaw) {
      const nr = (n ?? {}) as Record<string, unknown>
      const pitch = typeof nr.pitch === 'string' ? nr.pitch.trim() : ''
      const valid =
        instrument === 'drums'
          ? (DRUM_SOUNDS as readonly string[]).includes(pitch)
          : pitchToMidi(pitch) !== null
      if (!valid) continue
      const start = Math.round(num(nr.start, -1))
      if (start < 0 || start >= totalSteps) continue
      const length = clamp(Math.round(num(nr.length, 1)), 1, totalSteps - start)
      const key = instrument === 'bass' ? `${start}` : `${pitch}@${start}`
      if (seen.has(key)) continue
      seen.add(key)
      notes.push({ pitch, start, length, velocity: clamp(num(nr.velocity, 0.8), 0.05, 1) })
    }
    notes.sort((a, b) => a.start - b.start)
    return {
      id: typeof tr.id === 'string' && tr.id ? tr.id : newId(),
      name: typeof tr.name === 'string' && tr.name ? tr.name.slice(0, 40) : instrument,
      instrument,
      volume: clamp(num(tr.volume, 0.8), 0, 1),
      muted: tr.muted === true,
      notes
    }
  })

  return {
    title: typeof r.title === 'string' && r.title ? r.title.slice(0, 80) : 'Untitled',
    bpm: clamp(Math.round(num(r.bpm, 100)), 40, 220),
    key: typeof r.key === 'string' && r.key ? r.key.slice(0, 24) : 'C minor',
    bars,
    swing: clamp(num(r.swing, 0), 0, 0.5),
    tracks
  }
}

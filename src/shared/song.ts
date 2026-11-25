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
  /** Played by hand: Claude must not change it. */
  locked: boolean
  notes: Note[]
}

/** Autotune settings for a recorded take. */
export interface TuneSettings {
  on: boolean
  /** 0..1: how far each note is pulled to the target pitch. */
  strength: number
  /** Seconds to glide to the target. 0 = hard, robotic snap; 0.2 = natural. */
  speed: number
  /** Pull to the notes of the Vocal track when there is one, else to the key. */
  followMelody: boolean
}

export const VOICES = ['aria', 'leo', 'robo'] as const
export type VoiceId = (typeof VOICES)[number]

/**
 * A vocal recording or a generated sung part, placed on the loop. The audio
 * itself is kept separately (it's too big for the song file); this is
 * everything needed to place, mix and re-process it.
 */
export interface VocalTake {
  id: string
  name: string
  kind: 'recorded' | 'generated'
  /** 16th step in the loop where the take starts. */
  start: number
  /** Length in seconds. */
  duration: number
  /** 0..1 */
  volume: number
  muted: boolean
  tune: TuneSettings
  /** Generated takes: which voice sang it. */
  voice?: VoiceId
}

export const DEFAULT_TUNE: TuneSettings = { on: true, strength: 0.85, speed: 0.06, followMelody: true }

export interface Song {
  title: string
  bpm: number
  key: string
  bars: number
  /** 0..0.5 — delays every other 16th for groove. */
  swing: number
  /** Lyrics text with optional [Section] headers. */
  lyrics: string
  tracks: Track[]
  /** Recorded and generated vocals, played over the loop. */
  vocals: VocalTake[]
}

export function emptySong(): Song {
  return { title: 'Untitled', bpm: 100, key: 'C minor', bars: 2, swing: 0, lyrics: '', tracks: [], vocals: [] }
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
      locked: tr.locked === true,
      notes
    }
  })

  const vocalsRaw = Array.isArray(r.vocals) ? r.vocals : []
  const vocals: VocalTake[] = vocalsRaw.slice(0, 8).flatMap((v) => {
    const vr = (v ?? {}) as Record<string, unknown>
    if (typeof vr.id !== 'string' || !vr.id) return []
    const tr = (vr.tune ?? {}) as Record<string, unknown>
    const voice = (VOICES as readonly string[]).includes(vr.voice as string) ? (vr.voice as VoiceId) : undefined
    return [
      {
        id: vr.id.slice(0, 40),
        name: typeof vr.name === 'string' && vr.name ? vr.name.slice(0, 40) : 'Vocal take',
        kind: vr.kind === 'generated' ? 'generated' : 'recorded',
        start: clamp(Math.round(num(vr.start, 0)), 0, totalSteps - 1),
        duration: clamp(num(vr.duration, 0), 0, 600),
        volume: clamp(num(vr.volume, 0.9), 0, 1),
        muted: vr.muted === true,
        tune: {
          on: tr.on !== false,
          strength: clamp(num(tr.strength, DEFAULT_TUNE.strength), 0, 1),
          speed: clamp(num(tr.speed, DEFAULT_TUNE.speed), 0, 0.5),
          followMelody: tr.followMelody !== false
        },
        ...(voice ? { voice } : {})
      }
    ]
  })

  return {
    title: typeof r.title === 'string' && r.title ? r.title.slice(0, 80) : 'Untitled',
    bpm: clamp(Math.round(num(r.bpm, 100)), 40, 220),
    key: typeof r.key === 'string' && r.key ? r.key.slice(0, 24) : 'C minor',
    bars,
    swing: clamp(num(r.swing, 0), 0, 0.5),
    lyrics: typeof r.lyrics === 'string' ? r.lyrics.slice(0, 20000) : '',
    tracks,
    vocals
  }
}

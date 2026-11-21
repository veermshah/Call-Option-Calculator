import { midiToPitch, pitchToMidi } from './song'

// Small music-theory helpers for the computer-keyboard instrument.

const PC: Record<string, number> = {
  C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6,
  G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11
}

const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11]
}

export interface Scale {
  tonic: number // pitch class 0-11
  steps: number[] // semitone offsets of the 7 degrees
  name: string
}

/** "A minor", "F# dorian", "Eb", "c#m" -> Scale. Unknown input falls back to C major. */
export function parseKey(key: string): Scale {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(m(?![a-z])|[a-z]+)?/.exec(key)
  if (!m) return { tonic: 0, steps: MODES.major, name: 'C major' }
  const tonicName = (m[1] + m[2]).toUpperCase()
  const tonic = PC[tonicName] ?? 0
  const modeWord = (m[3] ?? 'major').toLowerCase()
  const mode = modeWord === 'm' || modeWord === 'min' ? 'minor' : MODES[modeWord] ? modeWord : 'major'
  return { tonic, steps: MODES[mode], name: `${m[1].toUpperCase()}${m[2]} ${mode}` }
}

/** Diatonic triad (or 7th) on scale degree 0-6 (wraps past 6 into the next octave), rooted near `baseMidi`. */
export function diatonicChord(scale: Scale, degree: number, baseMidi = 48, seventh = false): string[] {
  const tones = seventh ? [0, 2, 4, 6] : [0, 2, 4]
  // Root of the scale in the octave that contains baseMidi.
  const root = baseMidi - (((baseMidi - scale.tonic) % 12) + 12) % 12
  return tones.map((t) => {
    const d = degree + t
    const oct = Math.floor(d / 7)
    return midiToPitch(root + oct * 12 + scale.steps[((d % 7) + 7) % 7])
  })
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** Roman numeral for a degree, lower-case for minor/diminished triads. */
export function romanFor(scale: Scale, degree: number): string {
  const s = scale.steps
  const third = (s[(degree + 2) % 7] - s[degree % 7] + 12) % 12
  const fifth = (s[(degree + 4) % 7] - s[degree % 7] + 12) % 12
  const r = ROMAN[degree % 7]
  if (third === 4) return r
  return fifth === 6 ? `${r.toLowerCase()}°` : r.toLowerCase()
}

// ---------------------------------------------------------------------------
// Computer keyboard layout, piano-style: the home row is the white keys and
// the row above holds the black keys, like most DAWs.
// ---------------------------------------------------------------------------

/** KeyboardEvent.code -> semitone offset from C of the current octave. */
export const PIANO_KEYS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15,
  Semicolon: 16, Quote: 17
}

/** Home-row keys in chord mode: one diatonic chord per key, degrees I..VII then I an octave up. */
export const CHORD_KEYS: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyG: 4, KeyH: 5, KeyJ: 6, KeyK: 7
}

export const KEY_LABEL: Record<string, string> = {
  KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G',
  KeyY: 'Y', KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L', KeyP: 'P',
  Semicolon: ';', Quote: "'"
}

/**
 * Chord for the keyboard instrument: the diatonic triad on `degree`, folded
 * into one octave starting at `baseMidi` so consecutive chords stay in one
 * hand position (smooth voice leading) instead of climbing the keyboard.
 * Degree 7 is the tonic an octave up.
 */
export function keyboardChord(scale: Scale, degree: number, baseMidi = 60): string[] {
  const lift = degree >= 7 ? 12 : 0
  return diatonicChord(scale, degree % 7, baseMidi)
    .map((p) => pitchToMidi(p)!)
    .map((m) => baseMidi + ((((m - baseMidi) % 12) + 12) % 12) + lift)
    .sort((a, b) => a - b)
    .map(midiToPitch)
}

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Note name spelled the way the key is written (flats in flat keys). */
export function noteName(midi: number, scale: Scale): string {
  // Relative-major tonic decides: F, Bb, Eb, Ab, Db, Gb majors use flats.
  const third = scale.steps[2]
  const majorTonic = third === 3 ? (scale.tonic + 3) % 12 : scale.tonic
  const flat = [5, 10, 3, 8, 1, 6].includes(majorTonic)
  return (flat ? FLAT_NAMES : SHARP_NAMES)[((midi % 12) + 12) % 12]
}

// Turns lyrics + the Vocal track's melody into a singing score: which
// syllable each note sings and how it sounds (ARPAbet phonemes). Claude does
// the alignment; a spelling-rule fallback keeps it working without a key.

import { callStructured } from '../claude'
import { pitchToMidi, type Note, type Song } from '../song'
import { guessSyllables, parsePhonemes, type Phoneme } from './phonemes'
import type { SungNote } from './sing'

export interface Syllable {
  text: string
  /** Empty = hold the previous syllable's vowel on this note. */
  phonemes: Phoneme[]
}

export interface AlignRequest {
  lyrics: string
  melody: Note[]
  song: Song
}

export type AlignResult = { ok: true; syllables: Syllable[]; message: string } | { ok: false; error: string }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'syllables'],
  properties: {
    message: { type: 'string', description: 'One sentence to the musician: which lines the melody sings.' },
    syllables: {
      type: 'array',
      description: 'Exactly one entry per melody note, in the same order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'phonemes'],
        properties: {
          text: { type: 'string', description: 'The syllable as written, e.g. "lo" of "lonely". Empty string to hold the previous vowel.' },
          phonemes: {
            type: 'string',
            description: 'ARPAbet phonemes for this syllable as sung, space separated, no stress digits, e.g. "L OW". Empty to hold the previous vowel.'
          }
        }
      }
    }
  }
} as const

const SYSTEM = `You prepare lyrics for a singing synthesizer inside Riff, a music studio.
You get the song's lyrics and a vocal melody (a list of notes, in order). Assign one syllable to each note so the words fit the melody naturally: stressed syllables on longer or stronger notes, and each line starting after a rest where the melody breathes. Pick the lines the melody was written for (usually the chorus, or the first section).
If there are more notes than syllables, hold a vowel across notes (empty text and phonemes for the extra notes) or repeat the hook. If there are fewer notes than syllables, stop at a natural phrase end.
Give each syllable's pronunciation in ARPAbet as sung (CMU dictionary symbols: AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH). Every syllable that starts a new sound has exactly one vowel. Put consonants that end a word on the syllable they close, and consonants that start a word on the syllable they open.`

function describeMelody(melody: Note[]): string {
  return melody
    .map((n, i) => `${i}: ${n.pitch} at step ${n.start}, ${n.length} step${n.length === 1 ? '' : 's'}`)
    .join('\n')
}

export async function alignLyrics(
  apiKey: string,
  model: string,
  req: AlignRequest,
  onProgress: (chars: number) => void,
  signal?: AbortSignal,
  opts: { browser?: boolean } = {}
): Promise<AlignResult> {
  const melody = [...req.melody].sort((a, b) => a.start - b.start)
  const content = `Song: "${req.song.title}", ${req.song.bpm} bpm, ${req.song.key}. One step is a 16th note.

Lyrics:
${req.lyrics.trim()}

Melody (${melody.length} notes):
${describeMelody(melody)}`
  const res = await callStructured({
    apiKey,
    model,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    schema: SCHEMA as unknown as Record<string, unknown>,
    effort: 'low',
    onProgress,
    signal,
    browser: opts.browser,
    tooLongMessage: 'The melody was too long to prepare. Try a shorter Vocal part.'
  })
  if (!res.ok) return res
  try {
    const parsed = JSON.parse(res.text) as { message?: unknown; syllables?: unknown }
    const list = Array.isArray(parsed.syllables) ? parsed.syllables : []
    const syllables = list.map((s) => {
      const r = (s ?? {}) as Record<string, unknown>
      return { text: typeof r.text === 'string' ? r.text : '', phonemes: parsePhonemes(typeof r.phonemes === 'string' ? r.phonemes : '') }
    })
    if (!syllables.some((s) => s.phonemes.length)) return { ok: false, error: 'Claude did not return any syllables. Try again.' }
    return { ok: true, syllables, message: typeof parsed.message === 'string' ? parsed.message : '' }
  } catch {
    return { ok: false, error: 'Claude returned something that is not valid JSON. Try again.' }
  }
}

/** No Claude: spell the lyrics out with rules and give one syllable per note. */
export function guessAlignment(lyrics: string, melody: Note[]): Syllable[] {
  const syl = guessSyllables(lyrics)
  return melody.map((_, i) => syl[i] ?? { text: '', phonemes: [] })
}

/** The step where a generated take should begin: a little before the first note, for its consonants. */
export function leadInStart(melody: Note[]): number {
  const first = Math.min(...melody.map((n) => n.start))
  return Math.max(0, first - 2)
}

/** Melody + syllables -> notes for the synthesizer, timed from `fromStep`. */
export function buildScore(melody: Note[], syllables: Syllable[], bpm: number, fromStep: number): SungNote[] {
  const stepSec = 60 / bpm / 4
  const sorted = [...melody].sort((a, b) => a.start - b.start)
  const out: SungNote[] = []
  sorted.forEach((n, i) => {
    const midi = pitchToMidi(n.pitch)
    if (midi === null) return
    const s = syllables[i] ?? { text: '', phonemes: [] }
    // A note with nothing to sing and nothing before it to hold stays silent.
    if (!s.phonemes.length && !out.length) return
    out.push({ midi, start: (n.start - fromStep) * stepSec, dur: n.length * stepSec, velocity: n.velocity, phonemes: s.phonemes })
  })
  return out
}

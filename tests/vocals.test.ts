import { describe, expect, it } from 'vitest'
import { detectPitch, hzToMidi, midiToHz } from '@shared/vocals/pitch'
import { autotune, nearestInScale, type TuneContext } from '@shared/vocals/tune'
import { parseKey } from '@shared/theory'

const SR = 48000

/** A buzzy, voice-like tone with a few harmonics following a pitch curve (Hz per sample). */
function voiceLike(seconds: number, hzAt: (t: number) => number): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR))
  let ph = 0
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    ph += (2 * Math.PI * hzAt(t)) / SR
    let s = 0
    for (let h = 1; h <= 8; h++) s += Math.sin(h * ph) / h
    x[i] = 0.3 * s
  }
  return x
}

const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1]
function voicedMidi(x: Float32Array, from = 0.15, to = 0.85) {
  const tr = detectPitch(x, SR)
  const n = tr.f0.length
  const vals = Array.from(tr.f0.slice(Math.floor(n * from), Math.floor(n * to))).filter((v) => v > 0).map(hzToMidi)
  return { vals, track: tr }
}

describe('pitch detection', () => {
  it('finds the pitch of a steady tone', () => {
    for (const hz of [110, 196, 330, 523]) {
      const { vals } = voicedMidi(voiceLike(0.6, () => hz))
      expect(vals.length).toBeGreaterThan(20)
      expect(Math.abs(median(vals) - hzToMidi(hz))).toBeLessThan(0.1)
    }
  })
  it('reports silence as unvoiced', () => {
    const tr = detectPitch(new Float32Array(SR / 2), SR)
    expect(Array.from(tr.f0).every((v) => v === 0)).toBe(true)
  })
})

describe('autotune', () => {
  const ctx = (over: Partial<TuneContext> = {}): TuneContext => ({ sampleRate: SR, bpm: 120, key: 'C major', bars: 2, start: 0, melody: [], ...over })

  it('snaps to the nearest note of the key', () => {
    const scale = parseKey('C major')
    expect(nearestInScale(61.4, scale)).toBe(62) // C#+ -> D
    expect(nearestInScale(60.3, scale)).toBe(60)
    expect(nearestInScale(65.6, scale)).toBe(65) // F
  })

  it('pulls an off-key note onto the key', () => {
    // 0.4 semitone sharp of A3 (A is in C major).
    const off = midiToHz(57.4)
    const out = autotune(voiceLike(1, () => off), ctx(), { on: true, strength: 1, speed: 0, followMelody: false })
    const { vals } = voicedMidi(out, 0.25, 0.85)
    expect(Math.abs(median(vals) - 57)).toBeLessThan(0.12)
  })

  it('follows the Vocal melody when there is one', () => {
    // Sing a steady E4 while the melody says G4 for the whole first bar.
    const melody = [{ pitch: 'G4', start: 0, length: 16, velocity: 0.8 }]
    const out = autotune(voiceLike(1.5, () => midiToHz(64)), ctx({ melody }), { on: true, strength: 1, speed: 0.02, followMelody: true })
    const { vals } = voicedMidi(out, 0.2, 0.6)
    expect(Math.abs(median(vals) - 67)).toBeLessThan(0.15)
  })

  it('keeps the take the same length and leaves it alone when off', () => {
    const x = voiceLike(0.5, () => 200)
    expect(autotune(x, ctx(), { on: false, strength: 1, speed: 0, followMelody: false })).toBe(x)
    expect(autotune(x, ctx(), { on: true, strength: 1, speed: 0, followMelody: false }).length).toBe(x.length)
  })

  it('flattens a drifting pitch at hard retune speed', () => {
    // Wobbles +-0.35 semitone around A3.
    const out = autotune(voiceLike(1.2, (t) => midiToHz(57 + 0.35 * Math.sin(2 * Math.PI * 3 * t))), ctx(), { on: true, strength: 1, speed: 0, followMelody: false })
    const { vals } = voicedMidi(out, 0.2, 0.8)
    const spread = Math.max(...vals) - Math.min(...vals)
    expect(spread).toBeLessThan(0.35)
  })
})

import { guessSyllables, parsePhonemes } from '@shared/vocals/phonemes'
import { VOICE_PRESETS, renderSinging, type SungNote } from '@shared/vocals/sing'
import { buildScore, guessAlignment, leadInStart } from '@shared/vocals/score'

describe('phonemes', () => {
  it('parses ARPAbet with stress marks and junk', () => {
    expect(parsePhonemes('L AH1 V')).toEqual(['L', 'AH', 'V'])
    expect(parsePhonemes('hh-ah0 xx l ow1')).toEqual(['HH', 'AH', 'L', 'OW'])
  })
  it('guesses syllables from spelling', () => {
    const s = guessSyllables('[Chorus]\nI love the night\nwinter time')
    expect(s.map((x) => x.phonemes.join(' '))).toEqual(['AY', 'L AH V', 'DH AH', 'N AY T', 'W IH N', 'T ER', 'T AY M'])
  })
})

describe('Riff Voice singing synth', () => {
  const phrase: SungNote[] = [
    { midi: 69, start: 0.1, dur: 0.5, velocity: 0.9, phonemes: parsePhonemes('L AH') },
    { midi: 72, start: 0.6, dur: 0.5, velocity: 0.9, phonemes: parsePhonemes('M IY') },
    { midi: 67, start: 1.1, dur: 0.6, velocity: 0.9, phonemes: parsePhonemes('S OW N') }
  ]

  it('sings each note at its pitch', () => {
    const x = renderSinging(phrase, SR, VOICE_PRESETS.aria)
    for (const n of phrase) {
      // Middle of the vowel, before vibrato builds up.
      const a = Math.round((n.start + 0.12) * SR)
      const seg = x.slice(a, a + Math.round(0.12 * SR))
      const { vals } = voicedMidi(seg, 0, 1)
      expect(vals.length).toBeGreaterThan(3)
      expect(Math.abs(median(vals) - n.midi)).toBeLessThan(0.35)
    }
  })

  it('moves the melody for low voices and stays quiet in rests', () => {
    const x = renderSinging(phrase, SR, VOICE_PRESETS.leo)
    const a = Math.round(0.22 * SR)
    const { vals } = voicedMidi(x.slice(a, a + Math.round(0.12 * SR)), 0, 1)
    expect(Math.abs(median(vals) - 57)).toBeLessThan(0.35)
    const lead = x.slice(0, Math.round(0.03 * SR))
    expect(Math.max(...lead.map(Math.abs))).toBeLessThan(0.01)
    expect(x.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true)
  })

  it('builds a score from the Vocal track and lyrics', () => {
    const melody = [
      { pitch: 'A4', start: 4, length: 4, velocity: 0.8 },
      { pitch: 'C5', start: 8, length: 4, velocity: 0.8 },
      { pitch: 'G4', start: 12, length: 8, velocity: 0.8 }
    ]
    const from = leadInStart(melody)
    expect(from).toBe(2)
    const score = buildScore(melody, guessAlignment('hold on now', melody), 120, from)
    expect(score.map((n) => n.midi)).toEqual([69, 72, 67])
    expect(score[0].start).toBeCloseTo(2 * 0.125)
    expect(score[2].dur).toBeCloseTo(1)
    expect(score[1].phonemes).toEqual(['AA', 'N'])
  })
})

import { normalizeSong } from '@shared/song'
import { parseComposeOutput } from '@shared/composer'

describe('vocal takes in the song', () => {
  const take = { id: 'v1', name: 'Take 1', kind: 'recorded', start: 0, duration: 4, volume: 0.9, muted: false, tune: { on: true, strength: 0.8, speed: 0.05, followMelody: true } }

  it('keeps valid takes and clamps their settings', () => {
    const s = normalizeSong({ bars: 1, vocals: [{ ...take, start: 99, volume: 3, tune: { strength: 9 } }, { name: 'no id' }] })
    expect(s.vocals).toHaveLength(1)
    expect(s.vocals[0].start).toBe(15)
    expect(s.vocals[0].volume).toBe(1)
    expect(s.vocals[0].tune.strength).toBe(1)
    expect(normalizeSong({}).vocals).toEqual([])
  })

  it('survives a compose: the composer never sees or drops them', () => {
    const prev = normalizeSong({ bars: 4, lyrics: 'la la', vocals: [{ ...take, start: 40 }], tracks: [] })
    const res = parseComposeOutput(JSON.stringify({ message: 'ok', song: { title: 'x', bpm: 100, key: 'C major', bars: 2, swing: 0, tracks: [] } }), prev)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.song.vocals).toHaveLength(1)
      expect(res.song.vocals[0].start).toBe(31) // pulled inside the shorter loop
      expect(res.song.lyrics).toBe('la la')
    }
  })
})

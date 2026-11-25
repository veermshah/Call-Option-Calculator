// Riff Voice: a small singing synthesizer that runs anywhere (browser, worker,
// Node). A glottal pulse source shaped by a cascade of formant resonators
// (in the spirit of the Klatt synthesizer), driven by a phoneme timeline.
// No samples, no models, no network: the voice is entirely ours.

import type { VoiceId } from '../song'
import { CONSONANT_SOUNDS, DIPHTHONGS, VOWEL_FORMANTS, isVowel, type Consonant, type Phoneme, type Vowel } from './phonemes'

export interface SungNote {
  /** MIDI pitch as written in the melody. */
  midi: number
  /** Seconds from the start of the render. */
  start: number
  dur: number
  /** 0..1 */
  velocity: number
  /** The syllable's sounds. Empty = hold the previous vowel (a melisma). */
  phonemes: Phoneme[]
}

export interface VoicePreset {
  id: VoiceId
  label: string
  /** Multiplies every formant: >1 sounds smaller/brighter (higher voices). */
  formantScale: number
  /** Semitones to move the melody (e.g. -12 sings it an octave down). */
  transpose: number
  /** Vibrato depth in semitones. */
  vibrato: number
  /** 0..1 breath noise in the tone. */
  breath: number
  /** Seconds to glide between notes. */
  glide: number
  /** Open quotient of the glottal pulse: lower = buzzier, brighter. */
  openQuotient: number
  /** Natural pitch wobble on/off. */
  human: boolean
}

export const VOICE_PRESETS: Record<VoiceId, VoicePreset> = {
  aria: { id: 'aria', label: 'Aria (high, airy)', formantScale: 1.17, transpose: 0, vibrato: 0.32, breath: 0.12, glide: 0.045, openQuotient: 0.62, human: true },
  leo: { id: 'leo', label: 'Leo (low, warm)', formantScale: 1.0, transpose: -12, vibrato: 0.28, breath: 0.07, glide: 0.05, openQuotient: 0.55, human: true },
  robo: { id: 'robo', label: 'Robo (hard-tuned)', formantScale: 1.06, transpose: 0, vibrato: 0, breath: 0.02, glide: 0, openQuotient: 0.42, human: false }
}

// ---------------------------------------------------------------------------
// Timeline: every phoneme becomes one or more segments with target settings.
// ---------------------------------------------------------------------------

interface Segment {
  t0: number
  t1: number
  /** Formant targets F1-F3 (unscaled). */
  f: [number, number, number]
  /** Glide to these formants over the segment (diphthongs). */
  fEnd?: [number, number, number]
  /** Voicing, frication and aspiration amplitudes. */
  av: number
  af: number
  ah: number
  noiseFreq: number
  noiseBw: number
  nasal: number
  midi: number
}

const SILENT = (t0: number, t1: number, midi: number, f: [number, number, number]): Segment => ({
  t0, t1, f, av: 0, af: 0, ah: 0, noiseFreq: 3000, noiseBw: 2000, nasal: 0, midi
})

function consonantSegments(c: Consonant, t0: number, t1: number, midi: number, next: [number, number, number]): Segment[] {
  const s = CONSONANT_SOUNDS[c]
  const base: Segment = { ...SILENT(t0, t1, midi, s.formants) }
  const n = s.noise
  switch (s.cls) {
    case 'stop': {
      const split = t0 + (t1 - t0) * 0.6
      return [
        { ...base, t1: split, av: s.voiced ? 0.12 : 0 },
        { ...base, t0: split, f: next, af: n!.gain, ah: s.voiced ? 0 : 0.35, av: s.voiced ? 0.35 : 0, noiseFreq: n!.freq, noiseBw: n!.bw }
      ]
    }
    case 'affricate': {
      const split = t0 + (t1 - t0) * 0.35
      return [
        { ...base, t1: split, av: s.voiced ? 0.12 : 0 },
        { ...base, t0: split, af: n!.gain, av: s.voiced ? 0.3 : 0, noiseFreq: n!.freq, noiseBw: n!.bw }
      ]
    }
    case 'fricative':
      return [{ ...base, af: n!.gain, av: s.voiced ? 0.35 : 0, noiseFreq: n!.freq, noiseBw: n!.bw }]
    case 'aspirate':
      return [{ ...base, f: next, ah: 0.45 }]
    case 'nasal':
      return [{ ...base, av: 0.55, nasal: 1 }]
    case 'liquid':
    default:
      return [{ ...base, av: 0.7 }]
  }
}

export function buildTimeline(notes: SungNote[], voice: VoicePreset): Segment[] {
  const segs: Segment[] = []
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  let lastVowel: Vowel = 'AH'
  let cursor = 0 // nothing may start before the previous note's sounds end

  sorted.forEach((note, i) => {
    const midi = note.midi + voice.transpose
    const loud = 0.55 + 0.45 * note.velocity
    const vi = note.phonemes.findIndex(isVowel)
    const vowel: Vowel = vi >= 0 ? (note.phonemes[vi] as Vowel) : lastVowel
    lastVowel = vowel
    const onset = (vi >= 0 ? note.phonemes.slice(0, vi) : note.phonemes.filter((p) => !isVowel(p))) as Consonant[]
    const coda = (vi >= 0 ? note.phonemes.slice(vi + 1).filter((p) => !isVowel(p)) : []) as Consonant[]
    const end = note.start + note.dur
    const nextStart = sorted[i + 1]?.start ?? Infinity
    const vf = VOWEL_FORMANTS[vowel]

    // Onset consonants sit just before the beat so the vowel lands on it.
    const want = onset.reduce((s, c) => s + CONSONANT_SOUNDS[c].dur, 0)
    const room = Math.max(0, note.start - cursor)
    const scale = want > 0 ? Math.min(1, room / want, 1.5 * Math.max(0.12, note.dur) / want) : 1
    let t = note.start - want * Math.min(scale, 1)
    if (want > 0 && room < want * 0.4) t = note.start // no room before: eat into the note instead
    // Silence from the previous sound up to here.
    if (t > cursor) segs.push(SILENT(cursor, t, midi, vf))
    for (let k = 0; k < onset.length; k++) {
      const c = onset[k]
      const d = CONSONANT_SOUNDS[c].dur * (t >= note.start ? Math.min(1, note.dur * 0.35 / Math.max(want, 1e-3)) : scale)
      const nextF = k + 1 < onset.length ? CONSONANT_SOUNDS[onset[k + 1]].formants : vf
      segs.push(...consonantSegments(c, t, t + d, midi, nextF))
      t += d
    }

    // Coda consonants close the note; keep at least half the note for the vowel.
    const codaWant = coda.reduce((s, c) => s + CONSONANT_SOUNDS[c].dur, 0)
    const noteEnd = Math.min(end, nextStart)
    const codaLen = Math.min(codaWant, Math.max(0, (noteEnd - t) * 0.45))
    const vowelEnd = noteEnd - codaLen
    const vowelSeg: Segment = { ...SILENT(t, vowelEnd, midi, vf), av: loud, ah: 0 }
    const glide = DIPHTHONGS[vowel]
    if (glide && vowelEnd - t > 0.1) {
      const split = t + (vowelEnd - t) * 0.72
      segs.push({ ...vowelSeg, t1: split })
      segs.push({ ...vowelSeg, t0: split, fEnd: VOWEL_FORMANTS[glide] })
    } else segs.push(vowelSeg)
    let ct = vowelEnd
    for (const c of coda) {
      const d = codaWant ? (CONSONANT_SOUNDS[c].dur / codaWant) * codaLen : 0
      segs.push(...consonantSegments(c, ct, ct + d, midi, vf))
      ct += d
    }
    cursor = Math.max(ct, noteEnd)
  })
  return segs
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** Klatt digital resonator with coefficients that can change over time. */
class Resonator {
  private y1 = 0
  private y2 = 0
  private a = 1
  private b = 0
  private c = 0
  set(freq: number, bw: number, sr: number) {
    const T = 1 / sr
    this.c = -Math.exp(-2 * Math.PI * bw * T)
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * Math.min(freq, sr * 0.45) * T)
    this.a = 1 - this.b - this.c
  }
  tick(x: number) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Seeded noise so a render is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export function renderSinging(notes: SungNote[], sampleRate: number, voice: VoicePreset, tail = 0.4): Float32Array {
  const segs = buildTimeline(notes, voice)
  const endTime = segs.length ? Math.max(...segs.map((s) => s.t1)) + tail : tail
  const out = new Float32Array(Math.ceil(endTime * sampleRate))
  if (!segs.length) return out
  const noise = rng(0x5eed + notes.length)
  const wobble = rng(0xbeef)
  const CTRL = 32
  const dt = CTRL / sampleRate
  const k = (tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau))
  const kF = k(0.018), kAmpUp = k(0.006), kAmpDown = k(0.012), kPitch = k(voice.glide), kNoise = k(0.004)

  const tract = [new Resonator(), new Resonator(), new Resonator(), new Resonator(), new Resonator()]
  const fric = new Resonator()
  const fric2 = new Resonator()
  const nasalLp = new Resonator()
  nasalLp.set(300, 400, sampleRate)

  // Smoothed control values.
  let F1 = segs[0].f[0], F2 = segs[0].f[1], F3 = segs[0].f[2]
  let av = 0, af = 0, ah = 0, nasal = 0
  let nf = 3000, nbw = 2000
  let pitch = segs[0].midi
  let phase = 0
  let tilt = 0
  let prevFlow = 0
  let jitter = 0
  let seg = 0
  // Vibrato starts a little into each held note.
  let noteMidi = segs[0].midi
  let noteStartedAt = 0

  const oq = voice.openQuotient
  const Tp = oq * 0.72
  const Tn = oq * 0.28
  const fs = voice.formantScale

  for (let i0 = 0; i0 < out.length; i0 += CTRL) {
    const t = i0 / sampleRate
    while (seg + 1 < segs.length && segs[seg].t1 <= t) seg++
    const s = segs[seg]
    const inSeg = t >= s.t0 && t < s.t1
    const p = inSeg && s.fEnd ? (t - s.t0) / Math.max(1e-3, s.t1 - s.t0) : 0
    const tf = s.fEnd ? s.f.map((v, j) => v + (s.fEnd![j] - v) * p) : s.f
    const tav = inSeg ? s.av : 0
    const taf = inSeg ? s.af : 0
    const tah = inSeg ? s.ah : 0

    F1 += (tf[0] - F1) * kF
    F2 += (tf[1] - F2) * kF
    F3 += (tf[2] - F3) * kF
    av += (tav - av) * (tav > av ? kAmpUp : kAmpDown)
    af += (taf - af) * kNoise
    ah += (tah - ah) * kNoise
    nasal += ((inSeg ? s.nasal : 0) - nasal) * kF
    nf += (s.noiseFreq - nf) * kNoise
    nbw += (s.noiseBw - nbw) * kNoise
    if (s.midi !== noteMidi && tav > 0.3) { noteMidi = s.midi; noteStartedAt = t }
    pitch += (s.midi - pitch) * kPitch
    if (voice.human) jitter += (wobble() * 0.12 - jitter) * k(0.08)

    const held = t - noteStartedAt
    const vibDepth = voice.vibrato * Math.min(1, Math.max(0, (held - 0.22) / 0.3))
    const vib = vibDepth * Math.sin(2 * Math.PI * 5.4 * held)
    const f0 = midiHz(pitch + vib + jitter)

    // Nasals and closures darken F2/F3 a little and widen F1.
    tract[0].set(F1 * fs, 70 + 120 * nasal, sampleRate)
    tract[1].set(F2 * fs, 100 + 80 * nasal, sampleRate)
    tract[2].set(F3 * fs, 150, sampleRate)
    tract[3].set(3300 * fs, 250, sampleRate)
    tract[4].set(3900 * fs, 300, sampleRate)
    fric.set(nf, nbw, sampleRate)
    fric2.set(nf * 1.25, nbw, sampleRate)

    const end = Math.min(out.length, i0 + CTRL)
    for (let i = i0; i < end; i++) {
      phase += f0 / sampleRate
      if (phase >= 1) phase -= 1
      // Rosenberg glottal flow, differentiated for lip radiation.
      let flow = 0
      if (phase < Tp) flow = 0.5 * (1 - Math.cos((Math.PI * phase) / Tp))
      else if (phase < Tp + Tn) flow = Math.cos((Math.PI / 2) * ((phase - Tp) / Tn))
      let d = (flow - prevFlow) * ((2 * Tp * sampleRate) / (Math.PI * f0))
      prevFlow = flow
      tilt += (d - tilt) * 0.55
      d = tilt

      const n = noise()
      const breath = voice.breath * (flow > 0.2 ? 1 : 0.3)
      let src = av * (d + breath * n) + ah * n * 0.6
      for (const r of tract) src = r.tick(src)
      const nas = nasal > 0.01 ? nasalLp.tick(src) * nasal * 2.2 + src * (1 - nasal * 0.75) : src
      const hiss = af ? (fric.tick(n) + 0.5 * fric2.tick(n)) * af * 1.4 : 0
      out[i] = nas * 0.5 + hiss
    }
  }

  // Normalise and soft-limit.
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) {
    const g = 0.85 / peak
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * g * 1.1) / Math.tanh(1.1)
  }
  return out
}

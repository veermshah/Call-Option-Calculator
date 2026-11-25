// Pitch correction ("autotune") for a recorded vocal take.
//
// 1. Track the sung pitch (pitch.ts).
// 2. Decide the target note for every moment: the Vocal track's melody when
//    there is one, otherwise the nearest note of the song's key.
// 3. Glide the correction toward the target at the chosen retune speed.
// 4. Re-pitch the audio with TD-PSOLA, which moves the pitch while keeping
//    the timing and the vowel sound (formants) of the voice.

import { STEPS_PER_BAR, pitchToMidi, type Note, type Song, type TuneSettings } from '../song'
import { parseKey, type Scale } from '../theory'
import { detectPitch, hzToMidi, type PitchTrack } from './pitch'

export interface TuneContext {
  sampleRate: number
  /** Song facts the target comes from. */
  bpm: number
  key: string
  bars: number
  /** Loop step where the take starts. */
  start: number
  /** Notes of the Vocal track, if any (used when followMelody is on). */
  melody: Note[]
}

/** The melody to follow: a track named "Vocal" (or "Vox"/"Voice"), if the song has one. */
export function vocalMelody(song: Song): Note[] {
  const t = song.tracks.find((t) => /^(vocals?|vox|voice|lead vocal)$/i.test(t.name.trim()))
  return t ? t.notes.filter((n) => pitchToMidi(n.pitch) !== null) : []
}

export function tuneContext(song: Song, start: number, sampleRate: number): TuneContext {
  return { sampleRate, bpm: song.bpm, key: song.key, bars: song.bars, start, melody: vocalMelody(song) }
}

/** Nearest note of the scale to a (fractional) MIDI pitch. */
export function nearestInScale(m: number, scale: Scale): number {
  const base = Math.floor(m) - 12
  let best = Math.round(m)
  let bestDist = Infinity
  for (let n = base; n <= base + 24; n++) {
    const pc = (((n - scale.tonic) % 12) + 12) % 12
    if (!scale.steps.includes(pc)) continue
    const dist = Math.abs(n - m)
    if (dist < bestDist) { bestDist = dist; best = n }
  }
  return best
}

/** Per-frame target pitch (MIDI), or NaN where the frame is unvoiced. */
export function targetCurve(track: PitchTrack, ctx: TuneContext, followMelody: boolean): Float32Array {
  const scale = parseKey(ctx.key)
  const stepSec = 60 / ctx.bpm / 4
  const loop = ctx.bars * STEPS_PER_BAR
  const melody = followMelody ? ctx.melody.map((n) => ({ ...n, midi: pitchToMidi(n.pitch)! })) : []
  const out = new Float32Array(track.f0.length).fill(NaN)
  let held: number | null = null
  for (let i = 0; i < track.f0.length; i++) {
    const hz = track.f0[i]
    if (!hz) { held = null; continue }
    const m = hzToMidi(hz)
    let target: number | null = null
    if (melody.length) {
      const s = (((ctx.start + (track.offset + i * track.hop) / stepSec) % loop) + loop) % loop
      // The note sounding now, or one starting within a 16th (singers come in early).
      const note =
        melody.find((n) => s >= n.start && s < n.start + n.length) ??
        melody.find((n) => n.start - s > 0 && n.start - s <= 1)
      if (note) target = note.midi + 12 * Math.round((m - note.midi) / 12)
    }
    if (target === null) {
      // Hysteresis: stay on the current note until the voice is clearly nearer another.
      if (held !== null && Math.abs(m - held) < 0.65) target = held
      else target = nearestInScale(m, scale)
    }
    held = target
    out[i] = target
  }
  return out
}

/** Pitch-shift ratio per frame after strength and retune-speed smoothing. */
export function correctionRatios(track: PitchTrack, targets: Float32Array, tune: Pick<TuneSettings, 'strength' | 'speed'>): Float32Array {
  const ratios = new Float32Array(track.f0.length).fill(1)
  const alpha = tune.speed <= 0 ? 1 : 1 - Math.exp(-track.hop / tune.speed)
  let offset = 0
  let gap = 0
  for (let i = 0; i < track.f0.length; i++) {
    const hz = track.f0[i]
    if (!hz || Number.isNaN(targets[i])) {
      // Hold the correction through short gaps, let go after ~60 ms.
      if (++gap * track.hop > 0.06) offset = 0
      continue
    }
    gap = 0
    const want = (targets[i] - hzToMidi(hz)) * tune.strength
    offset += (want - offset) * alpha
    ratios[i] = Math.pow(2, offset / 12)
  }
  return ratios
}

interface Mark {
  pos: number
  period: number
  voiced: boolean
  ratio: number
}

/**
 * Time-domain pitch-synchronous overlap-add. `ratios` are per frame of the
 * pitch track. Duration is unchanged; only the pitch moves.
 */
export function psola(x: Float32Array, sampleRate: number, track: PitchTrack, ratios: Float32Array): Float32Array {
  const { hop, offset, f0 } = track
  const frameAt = (pos: number) => Math.min(f0.length - 1, Math.max(0, Math.round((pos / sampleRate - offset) / hop)))
  const unvoicedPeriod = Math.round(sampleRate * 0.005)

  // Analysis marks: one per pitch period where voiced, every 5 ms elsewhere.
  // Spacing them by the measured period keeps consecutive grains in phase.
  const marks: Mark[] = []
  let pos = 0
  while (pos < x.length) {
    const fr = frameAt(pos)
    const hz = f0.length ? f0[fr] : 0
    if (hz > 0) {
      const period = sampleRate / hz
      marks.push({ pos, period, voiced: true, ratio: ratios[fr] || 1 })
      pos += period
    } else {
      marks.push({ pos, period: unvoicedPeriod, voiced: false, ratio: 1 })
      pos += unvoicedPeriod
    }
  }

  const out = new Float32Array(x.length)
  const wsum = new Float32Array(x.length)
  let k = 0
  let ts = marks.length ? marks[0].pos : x.length
  while (ts < x.length) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1].pos - ts) <= Math.abs(marks[k].pos - ts)) k++
    const m = marks[k]
    const L = Math.max(2, Math.round(m.period))
    const center = Math.round(ts)
    const from = Math.round(m.pos)
    for (let j = -L; j <= L; j++) {
      const src = from + j
      const dst = center + j
      if (src < 0 || src >= x.length || dst < 0 || dst >= x.length) continue
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / L)
      out[dst] += x[src] * w
      wsum[dst] += w
    }
    ts += m.voiced ? m.period / m.ratio : m.period
  }
  // Where grains pile up (pitch raised) divide the extra gain back out.
  for (let i = 0; i < out.length; i++) if (wsum[i] > 1) out[i] /= wsum[i]
  return out
}

/** Autotune a mono take. Returns the corrected audio (same length). */
export function autotune(x: Float32Array, ctx: TuneContext, tune: TuneSettings): Float32Array {
  if (!tune.on || tune.strength <= 0) return x
  const track = detectPitch(x, ctx.sampleRate)
  const targets = targetCurve(track, ctx, tune.followMelody)
  const ratios = correctionRatios(track, targets, tune)
  return psola(x, ctx.sampleRate, track, ratios)
}

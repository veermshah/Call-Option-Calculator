// Pitch tracking for monophonic voice (YIN, de Cheveigné & Kawahara 2002).
// Works on a decimated copy of the signal (~16 kHz), which is plenty for a
// singing voice and keeps a 40-second take to well under a second of work.

export interface PitchTrack {
  /** Seconds between frames. */
  hop: number
  /** Seconds from the start of the audio to the centre of frame 0. */
  offset: number
  /** Fundamental in Hz per frame, 0 where unvoiced (silence, breaths, consonants). */
  f0: Float32Array
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Box-filter and decimate by an integer factor. */
function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x
  const out = new Float32Array(Math.floor(x.length / factor))
  for (let i = 0; i < out.length; i++) {
    let s = 0
    const o = i * factor
    for (let j = 0; j < factor; j++) s += x[o + j]
    out[i] = s / factor
  }
  return out
}

export interface PitchOptions {
  minHz?: number
  maxHz?: number
  /** Seconds between frames. */
  hop?: number
}

export function detectPitch(samples: Float32Array, sampleRate: number, opts: PitchOptions = {}): PitchTrack {
  const minHz = opts.minHz ?? 70
  const maxHz = opts.maxHz ?? 1100
  const hopSec = opts.hop ?? 0.006
  const factor = Math.max(1, Math.round(sampleRate / 16000))
  const x = decimate(samples, factor)
  const sr = sampleRate / factor
  const hop = Math.max(1, Math.round(hopSec * sr))
  const tauMin = Math.max(2, Math.floor(sr / maxHz))
  const tauMax = Math.ceil(sr / minHz)
  const win = Math.ceil(sr * 0.025)
  const frames = Math.max(0, Math.floor((x.length - win - tauMax) / hop) + 1)
  const f0 = new Float32Array(Math.max(frames, 0))
  const d = new Float32Array(tauMax + 2)

  // Loudness gate relative to the loudest part of the take.
  const rms = new Float32Array(frames)
  let peakRms = 0
  for (let f = 0; f < frames; f++) {
    const o = f * hop
    let e = 0
    for (let j = 0; j < win; j++) e += x[o + j] * x[o + j]
    rms[f] = Math.sqrt(e / win)
    if (rms[f] > peakRms) peakRms = rms[f]
  }
  const gate = Math.max(0.004, peakRms * 0.06)

  for (let f = 0; f < frames; f++) {
    if (rms[f] < gate) continue
    const o = f * hop
    // Difference function, then the cumulative mean normalised difference.
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0
      for (let j = 0; j < win; j++) {
        const v = x[o + j] - x[o + j + tau]
        s += v * v
      }
      d[tau] = s
    }
    let running = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau]
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1
    }
    let best = -1
    let bestVal = 1
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < 0.15) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++
        best = tau
        bestVal = d[tau]
        break
      }
    }
    if (best < 0) {
      // No clear dip: take the global minimum if it is still fairly periodic.
      for (let tau = tauMin; tau <= tauMax; tau++) if (d[tau] < bestVal) { bestVal = d[tau]; best = tau }
      if (bestVal > 0.3) continue
    }
    // Parabolic interpolation around the dip.
    let t = best
    if (best > tauMin && best < tauMax) {
      const a = d[best - 1], b = d[best], c = d[best + 1]
      const den = a - 2 * b + c
      if (den > 0) t = best + (0.5 * (a - c)) / den
    }
    f0[f] = sr / t
  }

  return { hop: hop / sr, offset: win / 2 / sr, f0: cleanTrack(f0) }
}

/** Median-smooth the voiced parts and fold isolated octave jumps back. */
function cleanTrack(f0: Float32Array): Float32Array {
  const out = new Float32Array(f0)
  const R = 2
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) continue
    const win: number[] = []
    for (let j = i - R; j <= i + R; j++) if (j >= 0 && j < f0.length && f0[j]) win.push(hzToMidi(f0[j]))
    if (win.length < 3) {
      // A lone voiced blip between silences is usually noise.
      if (win.length === 1) out[i] = 0
      continue
    }
    win.sort((a, b) => a - b)
    const med = win[win.length >> 1]
    let m = hzToMidi(f0[i])
    while (m - med > 9) m -= 12
    while (med - m > 9) m += 12
    out[i] = midiToHz(m)
  }
  return out
}

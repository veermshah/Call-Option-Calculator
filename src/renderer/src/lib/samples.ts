import * as Tone from 'tone'
import type { DrumSound } from '@shared/song'
import { instrumentDef, sampleNoteName, sampleNotes, type KitDef, type SampledDef } from '@shared/instruments'

// Loads sample files on demand, once per instrument, and keeps the decoded
// audio for the rest of the session. Files are served next to the app
// (src/renderer/public/samples), so this works on the web and in the desktop
// build alike.

export type SampleSet = Record<string, AudioBuffer> // note name ("Eb4") -> audio
export type KitSet = Partial<Record<DrumSound, AudioBuffer>>

const sampleSets = new Map<string, Promise<SampleSet>>()
const ready = new Map<string, SampleSet | KitSet>()
const files = new Map<string, Promise<AudioBuffer>>()

export const sampleUrl = (path: string) => new URL(`samples/${path}`, document.baseURI).href

function loadFile(path: string): Promise<AudioBuffer> {
  let p = files.get(path)
  if (!p) {
    p = Tone.ToneAudioBuffer.fromUrl(sampleUrl(path)).then((b) => b.get()!)
    // Let a failed download be tried again next time.
    p.catch(() => files.delete(path))
    files.set(path, p)
  }
  return p
}

function loadSampled(def: SampledDef): Promise<SampleSet> {
  const notes = sampleNotes(def).map(sampleNoteName)
  return Promise.all(notes.map((n) => loadFile(`${def.sample}/${n}.mp3`))).then((buffers) =>
    Object.fromEntries(notes.map((n, i) => [n, buffers[i]]))
  )
}

function loadKit(def: KitDef): Promise<KitSet> {
  const entries = Object.entries(def.sounds ?? {}) as [DrumSound, string][]
  return Promise.all(entries.map(([, file]) => loadFile(`drums/${file}.wav`))).then((buffers) =>
    Object.fromEntries(entries.map(([sound], i) => [sound, buffers[i]]))
  )
}

/**
 * Start loading an instrument's samples (no-op for synths). Resolves when
 * they're ready; rejects if a file couldn't be fetched.
 */
export function loadInstrument(id: string): Promise<void> {
  const def = instrumentDef(id)
  if (def.kind === 'synth' || (def.kind === 'kit' && !def.sounds)) return Promise.resolve()
  let p = sampleSets.get(def.id)
  if (!p) {
    p = def.kind === 'sampled' ? loadSampled(def) : loadKit(def)
    p.then((set) => ready.set(def.id, set)).catch((err) => {
      sampleSets.delete(def.id)
      console.warn(`Could not load the ${def.label} samples`, err)
    })
    sampleSets.set(def.id, p)
  }
  return p.then(() => undefined)
}

/** The decoded samples if they've finished loading, else undefined. */
export function loadedSamples(id: string): SampleSet | KitSet | undefined {
  return ready.get(instrumentDef(id).id)
}

export const needsSamples = (id: string) => {
  const def = instrumentDef(id)
  return def.kind === 'sampled' || (def.kind === 'kit' && def.sounds !== null)
}

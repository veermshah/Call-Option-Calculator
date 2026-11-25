import * as Tone from 'tone'
import type { DrumSound, Instrument, Note, Song, Track, VocalTake } from '@shared/song'
import { DRUM_SOUNDS, STEPS_PER_BAR, midiToPitch } from '@shared/song'
import { LiveNotes, MonoStack } from '@shared/liveNotes'
import { instrumentDef, sampleGainDb, type KitDef, type SampledDef } from '@shared/instruments'
import { loadInstrument, loadedSamples, needsSamples, type KitSet, type SampleSet } from './samples'

// A small Tone.js engine: one 16th-note tick drives every track, reading the
// latest song on each tick so edits are heard immediately.

interface Voice {
  trigger(note: Note, time: number, stepSeconds: number): void
  /** Live play from the computer keyboard: hold until release. */
  attack(pitch: string, velocity: number): void
  release(pitch: string): void
  output: Tone.Volume
  dispose(): void
}

// A key tapped and let go in the same instant (fast taps, key remappers that
// only send a key on release) would otherwise start and stop the envelope at
// the same moment and make no sound. Live notes last at least this long.
const MIN_LIVE_GATE = 0.09

/** Mono vocal audio as stored by the app. */
export interface VocalAudio {
  sampleRate: number
  data: Float32Array
}

function toBuffer(ctx: Tone.BaseContext, audio: VocalAudio): Tone.ToneAudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, audio.data.length), audio.sampleRate)
  buf.copyToChannel(audio.data as Float32Array<ArrayBuffer>, 0)
  return new Tone.ToneAudioBuffer(buf as unknown as AudioBuffer)
}

/** Seconds of a take that fit between its start and the end of the loop. */
const takeLength = (take: VocalTake, buffer: Tone.ToneAudioBuffer, total: number, stepSeconds: number) =>
  Math.max(0, Math.min(buffer.duration, (total - take.start) * stepSeconds))

const dbFromGain = (v: number) => (v <= 0.001 ? -Infinity : 20 * Math.log10(v))

function drumKit(out: Tone.Volume): { trigger: Voice['trigger']; dispose(): void } {
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 } }).connect(out)
  const tom = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 } }).connect(out)
  const snareFilter = new Tone.Filter(1800, 'bandpass').connect(out)
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(snareFilter)
  const snareBody = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(out)
  const clapFilter = new Tone.Filter(1200, 'bandpass').connect(out)
  const clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.003, decay: 0.22, sustain: 0 } }).connect(clapFilter)
  const hatFilter = new Tone.Filter(7000, 'highpass').connect(out)
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(hatFilter)
  const openhat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).connect(hatFilter)
  const rim = new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 1, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(out)
  const crashFilter = new Tone.Filter(5000, 'highpass').connect(out)
  const crash = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 1.6, sustain: 0 } }).connect(crashFilter)
  const ride = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.2, release: 0.3 }, harmonicity: 5.1, modulationIndex: 20, resonance: 5000, octaves: 1 }).connect(out)
  ride.frequency.value = 300
  ride.volume.value = -16
  const bellFilter = new Tone.Filter(900, 'bandpass').connect(out)
  const bell = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 } }).connect(bellFilter)
  bell.volume.value = -6

  const play: Record<DrumSound, (t: number, v: number) => void> = {
    kick: (t, v) => kick.triggerAttackRelease('C1', '8n', t, v),
    tom: (t, v) => tom.triggerAttackRelease('G2', '8n', t, v),
    snare: (t, v) => {
      snare.triggerAttackRelease('16n', t, v * 0.8)
      snareBody.triggerAttackRelease('A2', '32n', t, v * 0.6)
    },
    clap: (t, v) => clap.triggerAttackRelease('16n', t, v),
    hat: (t, v) => hat.triggerAttackRelease('32n', t, v * 0.5),
    openhat: (t, v) => openhat.triggerAttackRelease('8n', t, v * 0.45),
    rim: (t, v) => rim.triggerAttackRelease('E5', '32n', t, v * 0.7),
    crash: (t, v) => crash.triggerAttackRelease('2n', t, v * 0.4),
    ride: (t, v) => ride.triggerAttackRelease('8n', t, v * 0.6),
    cowbell: (t, v) => bell.triggerAttackRelease([540, 800], '16n', t, v * 0.5)
  }
  const nodes = [kick, tom, snare, snareBody, snareFilter, clap, clapFilter, hat, openhat, hatFilter, rim, crash, crashFilter, ride, bell, bellFilter]
  return {
    trigger: (note, time) => play[note.pitch as DrumSound]?.(time, note.velocity),
    dispose: () => nodes.forEach((n) => n.dispose())
  }
}

// How loud each drum sound sits in a sampled kit (the files are all peak-normalised).
const KIT_MIX: Record<DrumSound, number> = {
  kick: 1, snare: 0.85, clap: 0.8, hat: 0.45, openhat: 0.4, tom: 0.75, rim: 0.6, crash: 0.5, ride: 0.4, cowbell: 0.5
}

/** A drum kit that plays recorded hits. Silent until its samples arrive. */
function sampledKit(def: KitDef, out: Tone.Volume): { trigger: Voice['trigger']; dispose(): void } {
  let open: Tone.ToneBufferSource | null = null
  const live = new Set<Tone.ToneBufferSource>()
  // The synth kit stands in until the recordings arrive.
  let stand: ReturnType<typeof drumKit> | null = loadedSamples(def.id) ? null : drumKit(out)
  void loadInstrument(def.id).catch(() => {})
  return {
    trigger: (note, time, stepSeconds) => {
      const sound = note.pitch as DrumSound
      const buffer = (loadedSamples(def.id) as KitSet | undefined)?.[sound]
      if (!buffer) return stand?.trigger(note, time, stepSeconds)
      // A closed hat cuts off a ringing open hat, like a real one.
      if ((sound === 'hat' || sound === 'openhat') && open) {
        try { open.stop(time) } catch { /* already ended */ }
        open = null
      }
      const src = new Tone.ToneBufferSource(buffer).connect(out)
      src.fadeOut = 0.02
      src.onended = () => { live.delete(src); src.dispose() }
      live.add(src)
      src.start(time, 0, undefined, note.velocity * (KIT_MIX[sound] ?? 0.7))
      if (sound === 'openhat') open = src
    },
    dispose: () => {
      for (const src of live) src.dispose()
      live.clear()
      stand?.dispose()
      stand = null
    }
  }
}

/**
 * A recorded instrument. Until its samples have loaded it plays a plain synth
 * so nothing goes silent, then switches over.
 */
function sampledInstrument(def: SampledDef, out: Tone.Volume) {
  const fallback = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: Math.min(def.release, 0.8) }
  }).connect(out)
  fallback.volume.value = -10
  let sampler: Tone.Sampler | null = null
  let disposed = false
  const make = (set: SampleSet) => {
    if (disposed || sampler) return
    sampler = new Tone.Sampler({ urls: set, release: def.release, attack: 0 }).connect(out)
    sampler.volume.value = sampleGainDb(def.id) + 2
  }
  const now = loadedSamples(def.id) as SampleSet | undefined
  if (now) make(now)
  else void loadInstrument(def.id).then(() => make(loadedSamples(def.id) as SampleSet)).catch(() => {})
  // Which sound each held key started on, so its release goes to the same one.
  const heldOn = new Map<string, Tone.Sampler | Tone.PolySynth>()
  return {
    triggerAttackRelease: (pitch: string, duration: number, time: number, velocity: number) =>
      (sampler ?? fallback).triggerAttackRelease(pitch, duration, time, velocity),
    triggerAttack: (pitch: string, time: number, velocity: number) => {
      const s = sampler ?? fallback
      heldOn.set(pitch, s)
      s.triggerAttack(pitch, time, velocity)
    },
    triggerRelease: (pitch: string, time: number) => {
      const s = heldOn.get(pitch) ?? sampler ?? fallback
      heldOn.delete(pitch)
      s.triggerRelease(pitch, time)
    },
    dispose: () => {
      disposed = true
      fallback.dispose()
      sampler?.dispose()
    }
  }
}

function melodic(instrument: Instrument, out: Tone.Volume, fx: Tone.ToneAudioNode): Tone.PolySynth | Tone.MonoSynth {
  switch (instrument) {
    case 'bass':
      return new Tone.MonoSynth({
        oscillator: { type: 'sawtooth' },
        filter: { Q: 2, type: 'lowpass', rolloff: -24 },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 },
        filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2, baseFrequency: 120, octaves: 2.5 }
      }).connect(out)
    case 'lead':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
        envelope: { attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.25 }
      }).connect(out)
    case 'pad': {
      const p = new Tone.PolySynth(Tone.AMSynth, {
        envelope: { attack: 0.4, decay: 0.3, sustain: 0.8, release: 1.6 }
      })
      p.connect(out)
      p.connect(fx)
      return p
    }
    case 'pluck':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.002, decay: 0.25, sustain: 0.05, release: 0.3 }
      }).connect(out)
    case 'keys':
    default:
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 6,
        envelope: { attack: 0.005, decay: 0.6, sustain: 0.25, release: 0.8 }
      }).connect(out)
  }
}

function makeVoice(track: Track, master: Tone.ToneAudioNode, reverb: Tone.ToneAudioNode): Voice {
  const output = new Tone.Volume(dbFromGain(track.volume)).connect(master)
  const def = instrumentDef(track.instrument)
  if (def.kind === 'kit') {
    const kit = def.sounds ? sampledKit(def, output) : drumKit(output)
    return {
      output,
      trigger: kit.trigger,
      attack: (pitch, velocity) => kit.trigger({ pitch, start: 0, length: 1, velocity }, Tone.now() + 0.005, 0),
      release: () => {},
      dispose: () => { kit.dispose(); output.dispose() }
    }
  }
  if (def.kind === 'sampled') {
    const inst = sampledInstrument(def, output)
    const startedAt = new Map<string, number>()
    return {
      output,
      trigger: (note, time, stepSeconds) => {
        try {
          inst.triggerAttackRelease(note.pitch, Math.max(0.03, note.length * stepSeconds * 0.95), time, note.velocity)
        } catch (err) {
          console.warn('note skipped', note.pitch, err)
        }
      },
      attack: (pitch, velocity) => {
        const t = Tone.now() + 0.005
        startedAt.set(pitch, t)
        try { inst.triggerAttack(pitch, t, velocity) } catch (err) { console.warn('note skipped', pitch, err) }
      },
      release: (pitch) => {
        const t = Math.max(Tone.now() + 0.005, (startedAt.get(pitch) ?? 0) + MIN_LIVE_GATE)
        startedAt.delete(pitch)
        try { inst.triggerRelease(pitch, t) } catch { /* nothing held */ }
      },
      dispose: () => { inst.dispose(); output.dispose() }
    }
  }
  const synth = melodic(track.instrument, output, reverb)
  synth.volume.value = -8
  // One-voice synths (bass) play the newest held key and fall back to the
  // previous one on release, instead of going silent while a key is still down.
  const mono = synth instanceof Tone.MonoSynth ? new MonoStack() : null
  const startedAt = new Map<string, number>()
  let monoReleaseAt = 0
  return {
    output,
    trigger: (note, time, stepSeconds) => {
      synth.triggerAttackRelease(note.pitch, Math.max(0.03, note.length * stepSeconds * 0.95), time, note.velocity)
    },
    attack: (pitch, velocity) => {
      try {
        mono?.push(pitch)
        // Don't let a pending short-note release on the bass cut this new note.
        const t = Math.max(Tone.now() + 0.005, mono ? monoReleaseAt + 0.002 : 0)
        startedAt.set(pitch, t)
        synth.triggerAttack(pitch, t, velocity)
      } catch (err) {
        console.warn('note skipped', pitch, err)
      }
    },
    release: (pitch) => {
      const t = Math.max(Tone.now() + 0.005, (startedAt.get(pitch) ?? 0) + MIN_LIVE_GATE)
      startedAt.delete(pitch)
      if (synth instanceof Tone.MonoSynth) {
        const next = mono!.remove(pitch)
        if (next === null) {
          monoReleaseAt = t
          synth.triggerRelease(t)
        } else if (next) synth.setNote(next, t)
      } else synth.triggerRelease(pitch, t)
    },
    dispose: () => { synth.dispose(); output.dispose() }
  }
}

/** A few notes that show off an instrument: a groove for kits, an arpeggio otherwise. */
export function auditionPhrase(id: Instrument): Note[] {
  const def = instrumentDef(id)
  const n = (pitch: string, start: number, length = 1, velocity = 0.8): Note => ({ pitch, start, length, velocity })
  if (def.role === 'drums') {
    const kit: DrumSound[] = ['kick', 'hat', 'snare', 'hat', 'kick', 'kick', 'snare', 'openhat']
    return kit.filter((d) => (DRUM_SOUNDS as readonly string[]).includes(d)).map((d, i) => n(d, i * 2, 1, d === 'hat' ? 0.6 : 0.9))
  }
  // A C in the middle of the instrument's comfortable range.
  const root = Math.round((def.home[0] + def.home[1]) / 2 / 12) * 12
  if (def.role === 'bass') return [n(midiToPitch(root), 0, 3), n(midiToPitch(root + 7), 4, 3), n(midiToPitch(root + 12), 8, 2), n(midiToPitch(root), 12, 4)]
  return [
    ...[0, 4, 7, 12].map((iv, i) => n(midiToPitch(root + iv), i * 2, 2)),
    ...[0, 4, 7].map((iv) => n(midiToPitch(root + iv), 8, 8, 0.7))
  ]
}

export class Engine {
  private song: Song | null = null
  private voices = new Map<string, { voice: Voice; instrument: Instrument }>()
  private soloId: string | null = null
  private master: Tone.Volume
  private reverb: Tone.Reverb
  private tickId: number | null = null
  private step = 0
  // Vocal takes: decoded audio, a volume per take, and what is sounding now.
  private vocalBuffers = new Map<string, Tone.ToneAudioBuffer>()
  private vocalBus = new Map<string, Tone.Volume>()
  private vocalSources = new Set<Tone.ToneBufferSource>()
  private vocalReverb: Tone.Volume
  onStep: ((step: number) => void) | null = null

  constructor() {
    const limiter = new Tone.Limiter(-1).toDestination()
    this.master = new Tone.Volume(-4).connect(limiter)
    this.reverb = new Tone.Reverb({ decay: 3.5, wet: 1 })
    const reverbReturn = new Tone.Volume(-12).connect(this.master)
    this.reverb.connect(reverbReturn)
    // A little room on the voice so it sits in the mix.
    this.vocalReverb = new Tone.Volume(-6).connect(this.reverb)
  }

  /** Give the engine the audio for a vocal take (null removes it). */
  setVocalAudio(id: string, audio: VocalAudio | null) {
    if (!audio) this.vocalBuffers.delete(id)
    else this.vocalBuffers.set(id, toBuffer(Tone.getContext(), audio))
  }

  private syncVocals(song: Song) {
    const ids = new Set(song.vocals.map((v) => v.id))
    for (const [id, bus] of this.vocalBus) {
      if (!ids.has(id)) {
        bus.dispose()
        this.vocalBus.delete(id)
      }
    }
    for (const v of song.vocals) {
      let bus = this.vocalBus.get(v.id)
      if (!bus) {
        bus = new Tone.Volume(dbFromGain(v.volume)).connect(this.master)
        bus.connect(this.vocalReverb)
        this.vocalBus.set(v.id, bus)
      }
      const audible = this.soloId ? v.id === this.soloId : !v.muted
      bus.volume.rampTo(audible ? dbFromGain(v.volume) : -Infinity, 0.05)
    }
  }

  private stopVocals(time?: number) {
    for (const src of this.vocalSources) {
      try {
        src.stop(time)
      } catch {
        /* already stopped */
      }
    }
    if (time === undefined) this.vocalSources.clear()
  }

  setSong(song: Song) {
    this.song = song
    const transport = Tone.getTransport()
    transport.bpm.value = song.bpm
    transport.swing = song.swing
    transport.swingSubdivision = '16n'

    const ids = new Set(song.tracks.map((t) => t.id))
    for (const [id, v] of this.voices) {
      const track = song.tracks.find((t) => t.id === id)
      if (!ids.has(id) || !track || track.instrument !== v.instrument) {
        v.voice.dispose()
        this.voices.delete(id)
        this.live.forgetTrack(id)
      }
    }
    for (const t of song.tracks) {
      let v = this.voices.get(t.id)
      if (!v) {
        v = { voice: makeVoice(t, this.master, this.reverb), instrument: t.instrument }
        this.voices.set(t.id, v)
      }
      const audible = this.soloId ? t.id === this.soloId : !t.muted
      v.voice.output.volume.rampTo(audible ? dbFromGain(t.volume) : -Infinity, 0.05)
    }
    this.syncVocals(song)
  }

  setSolo(id: string | null) {
    this.soloId = id
    if (this.song) this.setSong(this.song)
  }

  get playing() {
    return Tone.getTransport().state === 'started'
  }

  /** Start from the top of the loop, now or at an exact audio-clock time. */
  async play(at?: number) {
    await Tone.start()
    const transport = Tone.getTransport()
    if (transport.state === 'started') this.stop()
    if (this.tickId === null) {
      this.tickId = transport.scheduleRepeat((time) => this.tick(time), '16n')
    }
    this.step = 0
    transport.start(at ?? '+0.05')
  }

  stop() {
    const transport = Tone.getTransport()
    transport.stop()
    if (this.tickId !== null) {
      transport.clear(this.tickId)
      this.tickId = null
    }
    this.step = 0
    this.stopVocals()
    this.onStep?.(-1)
  }

  /** Current playback position in (fractional) 16th steps within the loop, or -1 when stopped. */
  position(): number {
    const transport = Tone.getTransport()
    if (!this.song || transport.state !== 'started') return -1
    const total = this.song.bars * STEPS_PER_BAR
    // Use the time the listener is hearing now (no scheduling look-ahead) so
    // recorded notes land where they were played.
    const steps = transport.getTicksAtTime(Tone.immediate()) / (transport.PPQ / 4)
    return ((steps % total) + total) % total
  }

  // Counts how many keys hold each pitch so the synth gets one attack and one
  // release per pitch even when chords share notes.
  private live = new LiveNotes({
    attack: (trackId, pitch, velocity) => this.voices.get(trackId)?.voice.attack(pitch, velocity),
    release: (trackId, pitch) => this.voices.get(trackId)?.voice.release(pitch)
  })

  async noteOn(trackId: string, pitch: string, velocity = 0.8) {
    this.live.press(trackId, pitch)
    // The browser keeps audio suspended until the first key or click; wait for
    // it. `start` skips the note if the key was already let go meanwhile.
    if (Tone.getContext().state !== 'running') await Tone.start()
    this.live.start(trackId, pitch, velocity)
  }

  noteOff(trackId: string, pitch: string) {
    this.live.release(trackId, pitch)
  }

  /**
   * Start audio from inside a click or key press. Browsers only allow it in
   * response to one, and resuming can take a moment, so doing it on the first
   * interaction means the first notes played aren't lost.
   */
  unlock() {
    if (Tone.getContext().state !== 'running') void Tone.start().catch(() => {})
  }

  /** Panic: stop every live-played note on every track. */
  allNotesOff() {
    this.live.releaseAll()
  }

  private auditioner: { id: string; voice: Voice } | null = null

  /**
   * Play a short phrase on an instrument so it can be heard before (or right
   * after) picking it. Waits for its samples to load first.
   */
  async audition(id: Instrument) {
    await Tone.start()
    await loadInstrument(id).catch(() => {})
    if (this.auditioner?.id !== id) {
      const old = this.auditioner
      if (old) setTimeout(() => old.voice.dispose(), 4000)
      const track: Track = { id: 'audition', name: '', instrument: id, volume: 0.8, muted: false, locked: false, notes: [] }
      this.auditioner = { id, voice: makeVoice(track, this.master, this.reverb) }
    }
    const { voice } = this.auditioner
    const step = 60 / Math.max(90, Tone.getTransport().bpm.value) / 4
    const t0 = Tone.now() + 0.05
    for (const n of auditionPhrase(id)) voice.trigger(n, t0 + n.start * step, step)
  }

  /** Audition a single note (e.g. when clicking the piano roll). */
  async preview(trackId: string, note: Note) {
    await Tone.start()
    const v = this.voices.get(trackId)
    if (!v) return
    v.voice.trigger(note, Tone.now() + 0.01, Tone.Time('16n').toSeconds())
  }

  private tick(time: number) {
    const song = this.song
    if (!song) return
    const total = song.bars * STEPS_PER_BAR
    const step = this.step % total
    const stepSeconds = Tone.Time('16n').toSeconds()
    for (const t of song.tracks) {
      const audible = this.soloId ? t.id === this.soloId : !t.muted
      if (!audible) continue
      const v = this.voices.get(t.id)
      if (!v) continue
      for (const n of t.notes) if (n.start === step) v.voice.trigger(n, time, stepSeconds)
    }
    for (const take of song.vocals) {
      if (take.start !== step) continue
      const buffer = this.vocalBuffers.get(take.id)
      const bus = this.vocalBus.get(take.id)
      if (!buffer || !bus) continue
      const len = takeLength(take, buffer, total, stepSeconds)
      if (len <= 0) continue
      const src = new Tone.ToneBufferSource(buffer).connect(bus)
      src.fadeOut = 0.01
      src.onended = () => {
        this.vocalSources.delete(src)
        src.dispose()
      }
      this.vocalSources.add(src)
      src.start(time, 0, len)
    }
    Tone.getDraw().schedule(() => this.onStep?.(step), time)
    this.step = step + 1
  }

  dispose() {
    this.allNotesOff()
    this.stop()
    for (const v of this.voices.values()) v.voice.dispose()
    this.voices.clear()
    for (const b of this.vocalBus.values()) b.dispose()
    this.vocalBus.clear()
  }
}

/**
 * Render the song offline (faster than real time) with the same voices the
 * engine plays, `loops` times through plus a short tail for reverb. Muted
 * tracks are left out; solo is ignored so the export is the full mix.
 */
export async function renderSong(song: Song, loops = 4, vocals: Record<string, VocalAudio> = {}): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  // Recorded instruments must be in memory before the offline render starts.
  await Promise.all(song.tracks.filter((t) => !t.muted && needsSamples(t.instrument)).map((t) => loadInstrument(t.instrument)))
  const total = song.bars * STEPS_PER_BAR
  const stepSeconds = 60 / song.bpm / 4
  const duration = total * loops * stepSeconds + 3
  const buffer = await Tone.Offline(async (ctx) => {
    const limiter = new Tone.Limiter(-1).toDestination()
    const master = new Tone.Volume(-4).connect(limiter)
    const reverb = new Tone.Reverb({ decay: 3.5, wet: 1 })
    const reverbReturn = new Tone.Volume(-12).connect(master)
    reverb.connect(reverbReturn)
    await reverb.ready

    const transport = ctx.transport
    transport.bpm.value = song.bpm
    transport.swing = song.swing
    transport.swingSubdivision = '16n'

    const voices = song.tracks
      .filter((t) => !t.muted && t.notes.length)
      .map((t) => ({ track: t, voice: makeVoice(t, master, reverb) }))
    const vocalSend = new Tone.Volume(-6).connect(reverb)
    const takes = song.vocals
      .filter((v) => !v.muted && vocals[v.id])
      .map((v) => {
        const bus = new Tone.Volume(dbFromGain(v.volume)).connect(master)
        bus.connect(vocalSend)
        return { take: v, bus, buffer: toBuffer(ctx, vocals[v.id]) }
      })

    let step = 0
    transport.scheduleRepeat((time) => {
      if (step >= total * loops) return
      const s = step % total
      for (const { track, voice } of voices) {
        for (const n of track.notes) if (n.start === s) voice.trigger(n, time, stepSeconds)
      }
      for (const { take, bus, buffer } of takes) {
        if (take.start !== s) continue
        const len = takeLength(take, buffer, total, stepSeconds)
        if (len > 0) new Tone.ToneBufferSource(buffer).connect(bus).start(time, 0, len)
      }
      step++
    }, '16n')
    transport.start(0)
  }, duration)
  const audio = buffer.get()
  if (!audio) throw new Error('Nothing was rendered')
  const channels: Float32Array[] = []
  for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c))
  return { channels, sampleRate: audio.sampleRate }
}

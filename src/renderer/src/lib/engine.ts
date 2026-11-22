import * as Tone from 'tone'
import type { DrumSound, Instrument, Note, Song, Track } from '@shared/song'
import { STEPS_PER_BAR } from '@shared/song'

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
    rim: (t, v) => rim.triggerAttackRelease('E5', '32n', t, v * 0.7)
  }
  const nodes = [kick, tom, snare, snareBody, snareFilter, clap, clapFilter, hat, openhat, hatFilter, rim]
  return {
    trigger: (note, time) => play[note.pitch as DrumSound]?.(time, note.velocity),
    dispose: () => nodes.forEach((n) => n.dispose())
  }
}

function melodic(instrument: Exclude<Instrument, 'drums'>, out: Tone.Volume, fx: Tone.ToneAudioNode): Tone.PolySynth | Tone.MonoSynth {
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
  if (track.instrument === 'drums') {
    const kit = drumKit(output)
    return {
      output,
      trigger: kit.trigger,
      attack: (pitch, velocity) => kit.trigger({ pitch, start: 0, length: 1, velocity }, Tone.now() + 0.005, 0),
      release: () => {},
      dispose: () => { kit.dispose(); output.dispose() }
    }
  }
  const synth = melodic(track.instrument, output, reverb)
  synth.volume.value = -8
  return {
    output,
    trigger: (note, time, stepSeconds) => {
      synth.triggerAttackRelease(note.pitch, Math.max(0.03, note.length * stepSeconds * 0.95), time, note.velocity)
    },
    attack: (pitch, velocity) => {
      try {
        synth.triggerAttack(pitch, Tone.now() + 0.005, velocity)
      } catch (err) {
        console.warn('note skipped', pitch, err)
      }
    },
    release: (pitch) => {
      if (synth instanceof Tone.MonoSynth) synth.triggerRelease(Tone.now() + 0.005)
      else synth.triggerRelease(pitch, Tone.now() + 0.005)
    },
    dispose: () => { synth.dispose(); output.dispose() }
  }
}

export class Engine {
  private song: Song | null = null
  private voices = new Map<string, { voice: Voice; instrument: Instrument }>()
  private soloId: string | null = null
  private master: Tone.Volume
  private reverb: Tone.Reverb
  private tickId: number | null = null
  private step = 0
  onStep: ((step: number) => void) | null = null

  constructor() {
    const limiter = new Tone.Limiter(-1).toDestination()
    this.master = new Tone.Volume(-4).connect(limiter)
    this.reverb = new Tone.Reverb({ decay: 3.5, wet: 1 })
    const reverbReturn = new Tone.Volume(-12).connect(this.master)
    this.reverb.connect(reverbReturn)
  }

  setSong(song: Song) {
    this.song = song
    const transport = Tone.getTransport()
    transport.bpm.value = song.bpm
    transport.swing = song.swing
    transport.swingSubdivision = '16n'

    const live = new Set(song.tracks.map((t) => t.id))
    for (const [id, v] of this.voices) {
      const track = song.tracks.find((t) => t.id === id)
      if (!live.has(id) || !track || track.instrument !== v.instrument) {
        v.voice.dispose()
        this.voices.delete(id)
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
  }

  setSolo(id: string | null) {
    this.soloId = id
    if (this.song) this.setSong(this.song)
  }

  get playing() {
    return Tone.getTransport().state === 'started'
  }

  async play() {
    await Tone.start()
    const transport = Tone.getTransport()
    if (this.tickId === null) {
      this.tickId = transport.scheduleRepeat((time) => this.tick(time), '16n')
    }
    this.step = 0
    transport.start('+0.05')
  }

  stop() {
    const transport = Tone.getTransport()
    transport.stop()
    if (this.tickId !== null) {
      transport.clear(this.tickId)
      this.tickId = null
    }
    this.step = 0
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

  private held = new Set<string>()

  async noteOn(trackId: string, pitch: string, velocity = 0.8) {
    const k = `${trackId}|${pitch}`
    this.held.add(k)
    // The browser keeps audio suspended until the first key or click; wait for
    // it, and skip the note if the key was already let go in the meantime.
    if (Tone.getContext().state !== 'running') await Tone.start()
    if (!this.held.has(k)) return
    this.voices.get(trackId)?.voice.attack(pitch, velocity)
  }

  noteOff(trackId: string, pitch: string) {
    if (!this.held.delete(`${trackId}|${pitch}`)) return
    this.voices.get(trackId)?.voice.release(pitch)
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
    Tone.getDraw().schedule(() => this.onStep?.(step), time)
    this.step = step + 1
  }

  dispose() {
    this.stop()
    for (const v of this.voices.values()) v.voice.dispose()
    this.voices.clear()
  }
}

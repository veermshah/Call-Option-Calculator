import * as Tone from 'tone'

// Records the microphone sample-accurately on the same clock as the music, so
// a take lines up with the beat it was sung to.

const WORKLET = `
class RiffCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = true
    this.buf = new Float32Array(4096)
    this.n = 0
    this.first = 0
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) {
      if (this.n === 0) this.first = currentFrame
      if (this.n + ch.length > this.buf.length) this.flush()
      if (this.n === 0) this.first = currentFrame
      this.buf.set(ch, this.n)
      this.n += ch.length
      if (this.n >= this.buf.length) this.flush()
    }
    if (!this.on && this.n) this.flush()
    return this.on
  }
  flush() {
    this.port.postMessage({ frame: this.first, data: this.buf.slice(0, this.n) })
    this.n = 0
  }
}
registerProcessor('riff-capture', RiffCapture)
`

let moduleAdded: Promise<void> | null = null

function rawContext(): BaseAudioContext {
  return Tone.getContext().rawContext as unknown as BaseAudioContext
}

/** Seconds from "scheduled" to "heard" on the output, as well as the browser can tell. */
export function outputLatency(): number {
  const raw = rawContext() as AudioContext & { _nativeContext?: AudioContext }
  const native = raw._nativeContext ?? raw
  const v = native.outputLatency ?? native.baseLatency ?? raw.baseLatency ?? 0
  return Number.isFinite(v) ? v : 0
}

export class MicRecorder {
  private stream: MediaStream | null = null
  private source: AudioNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private chunks: { frame: number; data: Float32Array }[] = []
  /** 0..1 input level, updated as audio arrives. */
  level = 0
  onLevel: ((level: number) => void) | null = null

  get sampleRate() {
    return rawContext().sampleRate
  }

  /** Ask for the microphone. Throws a friendly message if it can't be had. */
  async open() {
    if (this.stream) return
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio. Try Chrome, Edge or Safari over https.')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation keeps the beat from your speakers out of the take;
        // the rest would colour the voice.
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      })
    } catch (err) {
      const name = (err as { name?: string }).name
      throw new Error(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the address bar, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug one in and try again.'
            : 'Could not open the microphone.'
      )
    }
    await Tone.start()
    const ctx = Tone.getContext()
    if (!moduleAdded) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      moduleAdded = ctx.addAudioWorkletModule(url)
    }
    await moduleAdded
    const raw = rawContext() as AudioContext
    this.source = raw.createMediaStreamSource(this.stream)
    this.node = ctx.createAudioWorkletNode('riff-capture') as unknown as AudioWorkletNode
    this.sink = raw.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.node)
    this.node.connect(this.sink)
    this.sink.connect(raw.destination)
    this.node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => {
      this.chunks.push(e.data)
      let s = 0
      for (const v of e.data.data) s += v * v
      const rms = Math.sqrt(s / e.data.data.length)
      this.level = Math.min(1, rms * 4)
      this.onLevel?.(this.level)
      // Keep only the last minute while idle so memory doesn't grow.
      if (this.chunks.length > 800) this.chunks.splice(0, this.chunks.length - 800)
    }
  }

  /** Input latency the browser reports for the mic, in seconds. */
  inputLatency(): number {
    const v = this.stream?.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined
    return v?.latency && Number.isFinite(v.latency) ? v.latency : 0
  }

  /** Samples captured between two context times (seconds). */
  slice(from: number, to: number): Float32Array {
    const sr = this.sampleRate
    const start = Math.round(from * sr)
    const end = Math.round(to * sr)
    const out = new Float32Array(Math.max(0, end - start))
    for (const c of this.chunks) {
      const a = Math.max(start, c.frame)
      const b = Math.min(end, c.frame + c.data.length)
      if (b <= a) continue
      out.set(c.data.subarray(a - c.frame, b - c.frame), a - start)
    }
    return out
  }

  /** Context time of the newest captured sample. */
  capturedUntil(): number {
    const c = this.chunks[this.chunks.length - 1]
    return c ? (c.frame + c.data.length) / this.sampleRate : 0
  }

  close() {
    this.node?.port.postMessage('stop')
    this.source?.disconnect()
    this.node?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = this.source = this.node = this.sink = null
    this.chunks = []
    this.level = 0
  }
}

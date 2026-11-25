// Bookkeeping for notes played live from the computer keyboard.
//
// Several keys can ask for the same pitch at once (in chord mode, neighbouring
// chords share two of their three notes). The synth must hear exactly one
// attack and one release per pitch, or a voice is left sounding with nothing
// able to stop it, and those stuck voices eventually use up the synth's
// polyphony so new notes are dropped. This keeps a count of holders per
// track+pitch and only talks to the synth on the first press and last release.

export interface LiveSink {
  attack(trackId: string, pitch: string, velocity: number): void
  release(trackId: string, pitch: string): void
}

const keyOf = (trackId: string, pitch: string) => `${trackId}|${pitch}`

export class LiveNotes {
  private holders = new Map<string, number>()
  private sounding = new Map<string, { trackId: string; pitch: string }>()
  /** Quick taps that ended before audio was ready: still played, briefly. */
  private tapped = new Set<string>()

  constructor(private sink: LiveSink) {}

  /** A key asking for this pitch went down. Call `start` once audio is ready. */
  press(trackId: string, pitch: string) {
    const k = keyOf(trackId, pitch)
    this.holders.set(k, (this.holders.get(k) ?? 0) + 1)
  }

  /**
   * Make the pitch sound if a key still holds it and it isn't sounding yet. A
   * tap that was already let go (audio took a moment to start) still plays,
   * as a short note, instead of being silently dropped.
   */
  start(trackId: string, pitch: string, velocity: number) {
    const k = keyOf(trackId, pitch)
    if (this.sounding.has(k)) return
    if (!this.holders.get(k)) {
      if (!this.tapped.delete(k)) return
      this.sink.attack(trackId, pitch, velocity)
      this.sink.release(trackId, pitch)
      return
    }
    this.tapped.delete(k)
    this.sounding.set(k, { trackId, pitch })
    this.sink.attack(trackId, pitch, velocity)
  }

  /** A key holding this pitch went up. The sound stops when the last holder lets go. */
  release(trackId: string, pitch: string) {
    const k = keyOf(trackId, pitch)
    const n = this.holders.get(k)
    if (!n) return
    if (n > 1) {
      this.holders.set(k, n - 1)
      return
    }
    this.holders.delete(k)
    if (this.sounding.delete(k)) this.sink.release(trackId, pitch)
    else this.tapped.add(k)
  }

  /** Forget a track's notes without releasing them (its synth was disposed). */
  forgetTrack(trackId: string) {
    const prefix = `${trackId}|`
    for (const k of [...this.holders.keys()]) if (k.startsWith(prefix)) this.holders.delete(k)
    for (const k of [...this.sounding.keys()]) if (k.startsWith(prefix)) this.sounding.delete(k)
    for (const k of [...this.tapped]) if (k.startsWith(prefix)) this.tapped.delete(k)
  }

  /** Stop everything that is sounding and clear all holders. */
  releaseAll() {
    const all = [...this.sounding.values()]
    this.holders.clear()
    this.sounding.clear()
    this.tapped.clear()
    for (const { trackId, pitch } of all) this.sink.release(trackId, pitch)
  }

  isSounding(trackId: string, pitch: string) {
    return this.sounding.has(keyOf(trackId, pitch))
  }

  get soundingCount() {
    return this.sounding.size
  }
}

/**
 * Note priority for a one-voice synth (bass): the newest held key sounds, and
 * letting go of it falls back to the one still held underneath instead of
 * silencing it.
 */
export class MonoStack {
  private stack: string[] = []

  /** Returns the pitch that should now sound. */
  push(pitch: string): string {
    this.stack = this.stack.filter((p) => p !== pitch)
    this.stack.push(pitch)
    return pitch
  }

  /**
   * Returns what to do after letting go: `null` to release the synth, a pitch
   * to glide back to, or `undefined` when the sounding note is unchanged.
   */
  remove(pitch: string): string | null | undefined {
    const top = this.stack[this.stack.length - 1]
    this.stack = this.stack.filter((p) => p !== pitch)
    if (!this.stack.length) return top === pitch ? null : undefined
    return top === pitch ? this.stack[this.stack.length - 1] : undefined
  }

  clear() {
    this.stack = []
  }
}

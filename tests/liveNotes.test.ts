import { describe, expect, it } from 'vitest'
import { LiveNotes, MonoStack } from '@shared/liveNotes'
import { keyboardChord, parseKey } from '@shared/theory'

/** Mimics Tone.PolySynth: every attack takes a voice, a release frees the oldest unreleased voice on that pitch. */
function fakePoly() {
  const voices: { pitch: string; released: boolean }[] = []
  return {
    sink: {
      attack: (_t: string, pitch: string) => void voices.push({ pitch, released: false }),
      release: (_t: string, pitch: string) => {
        const v = voices.find((x) => x.pitch === pitch && !x.released)
        if (v) v.released = true
      }
    },
    sounding: () => voices.filter((v) => !v.released).map((v) => v.pitch).sort()
  }
}

const cMinor = parseKey('C minor')
const chord = (degree: number) => keyboardChord(cMinor, degree, 60)

describe('LiveNotes', () => {
  it('leaves nothing sounding when overlapping chords share notes (A then D, rolled)', () => {
    const poly = fakePoly()
    const live = new LiveNotes(poly.sink)
    const a = chord(0) // C Eb G
    const d = chord(2) // Eb G Bb
    expect(a.filter((p) => d.includes(p)).length).toBe(2)
    for (const p of a) { live.press('t', p); live.start('t', p, 0.8) }
    for (const p of d) { live.press('t', p); live.start('t', p, 0.8) }
    for (const p of a) live.release('t', p)
    // D is still held: its three notes keep sounding.
    expect(poly.sounding()).toEqual([...d].sort())
    for (const p of d) live.release('t', p)
    expect(poly.sounding()).toEqual([])
    expect(live.soundingCount).toBe(0)
  })

  it('stays clean through a long run of rolled chords in every order', () => {
    const poly = fakePoly()
    const live = new LiveNotes(poly.sink)
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 2, 0, 3, 1, 4, 2, 5, 3]
    let prev: string[] | null = null
    for (const deg of order) {
      const next = chord(deg)
      for (const p of next) { live.press('t', p); live.start('t', p, 0.8) }
      if (prev) for (const p of prev) live.release('t', p)
      prev = next
    }
    for (const p of prev!) live.release('t', p)
    expect(poly.sounding()).toEqual([])
  })

  it('skips the attack if the key was let go before audio started', () => {
    const poly = fakePoly()
    const live = new LiveNotes(poly.sink)
    live.press('t', 'C4')
    live.release('t', 'C4')
    live.start('t', 'C4', 0.8)
    expect(poly.sounding()).toEqual([])
  })

  it('can play a pitch again after its track synth was replaced', () => {
    const poly = fakePoly()
    const live = new LiveNotes(poly.sink)
    live.press('t', 'C4')
    live.start('t', 'C4', 0.8)
    live.forgetTrack('t')
    live.press('t', 'C4')
    live.start('t', 'C4', 0.8)
    expect(live.isSounding('t', 'C4')).toBe(true)
  })

  it('releaseAll stops everything', () => {
    const poly = fakePoly()
    const live = new LiveNotes(poly.sink)
    for (const p of chord(0)) { live.press('t', p); live.start('t', p, 0.8) }
    live.press('u', 'C2'); live.start('u', 'C2', 0.8)
    live.releaseAll()
    expect(poly.sounding()).toEqual([])
    // Late keyups after a release-all are ignored.
    live.release('t', 'C4')
    expect(poly.sounding()).toEqual([])
  })
})

describe('MonoStack', () => {
  it('falls back to the key still held instead of going silent', () => {
    const m = new MonoStack()
    m.push('C2')
    m.push('D2')
    expect(m.remove('D2')).toBe('C2')
    expect(m.remove('C2')).toBe(null)
  })

  it('keeps the newest note when an older key is let go', () => {
    const m = new MonoStack()
    m.push('C2')
    m.push('D2')
    expect(m.remove('C2')).toBe(undefined)
    expect(m.remove('D2')).toBe(null)
  })
})

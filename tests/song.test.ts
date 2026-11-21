import { describe, expect, it } from 'vitest'
import { midiToPitch, normalizeSong, pitchToMidi } from '@shared/song'
import { songToMidi } from '@shared/midi'
import { parseComposeOutput } from '@shared/composer'

describe('pitch helpers', () => {
  it('round-trips pitches', () => {
    expect(pitchToMidi('C4')).toBe(60)
    expect(pitchToMidi('A4')).toBe(69)
    expect(pitchToMidi('Bb3')).toBe(58)
    expect(pitchToMidi('F#2')).toBe(42)
    expect(pitchToMidi('kick')).toBeNull()
    expect(midiToPitch(61)).toBe('C#4')
  })
})

describe('normalizeSong', () => {
  it('clamps values and drops invalid notes', () => {
    const s = normalizeSong({
      bpm: 999,
      bars: 1,
      swing: 2,
      tracks: [
        {
          name: 'Drums',
          instrument: 'drums',
          notes: [
            { pitch: 'kick', start: 0, length: 1, velocity: 1 },
            { pitch: 'kick', start: 0, length: 1, velocity: 1 }, // duplicate
            { pitch: 'C4', start: 4, length: 1, velocity: 1 }, // not a drum
            { pitch: 'snare', start: 16, length: 1, velocity: 1 } // outside 1 bar
          ]
        },
        {
          name: 'Bass',
          instrument: 'bass',
          notes: [
            { pitch: 'C2', start: 14, length: 8, velocity: 3 },
            { pitch: 'E2', start: 14, length: 1, velocity: 1 }, // mono collision
            { pitch: 'nope', start: 0, length: 1, velocity: 1 }
          ]
        },
        { name: 'X', instrument: 'theremin', notes: [] }
      ]
    })
    expect(s.bpm).toBe(220)
    expect(s.swing).toBe(0.5)
    expect(s.tracks[0].notes).toEqual([{ pitch: 'kick', start: 0, length: 1, velocity: 1 }])
    expect(s.tracks[1].notes).toEqual([{ pitch: 'C2', start: 14, length: 2, velocity: 1 }])
    expect(s.tracks[2].instrument).toBe('keys')
    expect(s.tracks.every((t) => t.id)).toBe(true)
  })

  it('survives garbage', () => {
    expect(normalizeSong(null).tracks).toEqual([])
    expect(normalizeSong({ tracks: 'x' }).bars).toBe(2)
  })
})

describe('parseComposeOutput', () => {
  const previous = normalizeSong({
    tracks: [{ id: 'keep-me', name: 'Bass', instrument: 'bass', muted: true, notes: [] }]
  })

  it('keeps ids and mute state of surviving tracks', () => {
    const text = JSON.stringify({
      message: 'Made it funkier.',
      song: {
        title: 'Funk', bpm: 110, key: 'E minor', bars: 1, swing: 0.1,
        tracks: [
          { name: 'bass', instrument: 'bass', volume: 0.9, notes: [{ pitch: 'E1', start: 0, length: 2, velocity: 0.9 }] },
          { name: 'Drums', instrument: 'drums', volume: 0.8, notes: [{ pitch: 'kick', start: 0, length: 1, velocity: 1 }] }
        ]
      }
    })
    const res = parseComposeOutput(text, previous)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.message).toBe('Made it funkier.')
    expect(res.song.tracks[0].id).toBe('keep-me')
    expect(res.song.tracks[0].muted).toBe(true)
    expect(res.song.tracks[1].id).not.toBe('keep-me')
  })

  it('reports bad JSON', () => {
    const res = parseComposeOutput('{oops', previous)
    expect(res.ok).toBe(false)
  })
})

describe('songToMidi', () => {
  it('writes a valid SMF header and one track per unmuted part plus conductor', () => {
    const song = normalizeSong({
      bpm: 120,
      bars: 1,
      tracks: [
        { name: 'Keys', instrument: 'keys', notes: [{ pitch: 'C4', start: 0, length: 4, velocity: 0.8 }] },
        { name: 'Drums', instrument: 'drums', notes: [{ pitch: 'kick', start: 0, length: 1, velocity: 1 }] },
        { name: 'Muted', instrument: 'lead', muted: true, notes: [{ pitch: 'C5', start: 0, length: 1, velocity: 1 }] }
      ]
    })
    const bytes = songToMidi(song)
    const head = String.fromCharCode(...bytes.slice(0, 4))
    expect(head).toBe('MThd')
    expect((bytes[10] << 8) | bytes[11]).toBe(3) // conductor + keys + drums
    expect((bytes[12] << 8) | bytes[13]).toBe(96)
    // contains a note-on for middle C on channel 0 and a kick on channel 10
    const arr = Array.from(bytes)
    const has = (seq: number[]) => arr.some((_, i) => seq.every((b, j) => arr[i + j] === b))
    expect(has([0x90, 60])).toBe(true)
    expect(has([0x99, 36])).toBe(true)
  })
})

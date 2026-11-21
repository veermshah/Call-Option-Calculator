import { describe, expect, it } from 'vitest'
import { diatonicChord, parseKey, romanFor } from '@shared/theory'
import { normalizeSong } from '@shared/song'
import { restoreLocked } from '@shared/composer'

describe('parseKey', () => {
  it('reads tonic and mode', () => {
    expect(parseKey('A minor')).toMatchObject({ tonic: 9, name: 'A minor' })
    expect(parseKey('F# dorian')).toMatchObject({ tonic: 6, name: 'F# dorian' })
    expect(parseKey('Ebm').tonic).toBe(3)
    expect(parseKey('Ebm').name).toBe('Eb minor')
    expect(parseKey('???').name).toBe('C major')
  })
})

describe('diatonicChord', () => {
  it('builds triads in C major', () => {
    const c = parseKey('C major')
    expect(diatonicChord(c, 0, 60)).toEqual(['C4', 'E4', 'G4'])
    expect(diatonicChord(c, 4, 60)).toEqual(['G4', 'B4', 'D5'])
    expect(diatonicChord(c, 7, 60)).toEqual(['C5', 'E5', 'G5'])
  })
  it('builds triads in A minor from the right octave', () => {
    const a = parseKey('A minor')
    expect(diatonicChord(a, 0, 60)).toEqual(['A3', 'C4', 'E4'])
    expect(diatonicChord(a, 3, 60)).toEqual(['D4', 'F4', 'A4'])
  })
  it('labels chord quality', () => {
    const c = parseKey('C major')
    expect([0, 1, 4, 6].map((d) => romanFor(c, d))).toEqual(['I', 'ii', 'V', 'vii°'])
  })
})

describe('restoreLocked', () => {
  it('puts locked tracks back exactly and drops model copies of them', () => {
    const previous = normalizeSong({
      tracks: [{ id: 'mine', name: 'My Part', instrument: 'keys', locked: true, notes: [{ pitch: 'C4', start: 0, length: 4, velocity: 0.8 }] }]
    })
    const fromModel = normalizeSong({
      tracks: [
        { name: 'My Part', instrument: 'lead', notes: [{ pitch: 'D4', start: 2, length: 1, velocity: 1 }] },
        { name: 'Drums', instrument: 'drums', notes: [{ pitch: 'kick', start: 0, length: 1, velocity: 1 }] }
      ]
    })
    const out = restoreLocked(fromModel, previous, ['mine'])
    expect(out.tracks.map((t) => t.name)).toEqual(['My Part', 'Drums'])
    expect(out.tracks[0]).toEqual(previous.tracks[0])
  })
})

import { keyboardChord, noteName } from '@shared/theory'

describe('keyboardChord', () => {
  it('keeps chords in one octave for smooth voice leading', () => {
    const c = parseKey('C minor')
    expect(keyboardChord(c, 0, 60)).toEqual(['C4', 'D#4', 'G4'])
    expect(keyboardChord(c, 5, 60)).toEqual(['C4', 'D#4', 'G#4']) // Ab major, 1st inversion
    expect(keyboardChord(c, 7, 60)).toEqual(['C5', 'D#5', 'G5'])
  })
  it('spells notes for the key', () => {
    expect(noteName(63, parseKey('C minor'))).toBe('Eb')
    expect(noteName(66, parseKey('E minor'))).toBe('F#')
    expect(noteName(70, parseKey('F major'))).toBe('Bb')
  })
})

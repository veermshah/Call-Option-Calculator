import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATALOG, GM_NAMES, instrumentDef, instrumentGroups, sampleGainDb, sampleNoteName, sampleNotes } from '@shared/instruments'
import { DRUM_SOUNDS, INSTRUMENTS, normalizeSong } from '@shared/song'
import { songToMidi } from '@shared/midi'
import { instrumentGuide, SONG_RESPONSE_SCHEMA } from '@shared/composer'

const samples = join(__dirname, '../src/renderer/public/samples')

describe('instrument catalog', () => {
  it('keeps the original six synths so saved songs sound the same', () => {
    for (const id of ['drums', 'bass', 'lead', 'pad', 'pluck', 'keys']) {
      const def = instrumentDef(id)
      expect(def.id).toBe(id)
      expect(def.kind === 'synth' || (def.kind === 'kit' && def.sounds === null)).toBe(true)
    }
  })

  it('has unique ids, valid GM programs and a picker group for everything', () => {
    expect(new Set(INSTRUMENTS).size).toBe(INSTRUMENTS.length)
    expect(INSTRUMENTS.length).toBeGreaterThan(60)
    for (const d of CATALOG) if (d.kind !== 'kit') expect(d.gm).toBeGreaterThanOrEqual(0)
    expect(instrumentGroups().flatMap((g) => g.items).length).toBe(CATALOG.length)
  })

  it('has every sample file on disk', () => {
    const missing: string[] = []
    for (const d of CATALOG) {
      if (d.kind === 'sampled') {
        expect(GM_NAMES).toContain(d.sample)
        for (const m of sampleNotes(d)) {
          const f = join(samples, d.sample, `${sampleNoteName(m)}.mp3`)
          if (!existsSync(f)) missing.push(f)
        }
        expect(Number.isFinite(sampleGainDb(d.id))).toBe(true)
      }
      if (d.kind === 'kit' && d.sounds) {
        expect(Object.keys(d.sounds).sort()).toEqual([...DRUM_SOUNDS].sort())
        for (const f of Object.values(d.sounds)) if (!existsSync(join(samples, 'drums', `${f}.wav`))) missing.push(f)
      }
    }
    expect(missing).toEqual([])
    expect(existsSync(join(samples, 'CREDITS.md'))).toBe(true)
  })

  it('names sample files with flats', () => {
    expect(sampleNoteName(60)).toBe('C4')
    expect(sampleNoteName(63)).toBe('Eb4')
    expect(sampleNoteName(21)).toBe('A0')
  })
})

describe('songs with new instruments', () => {
  const song = normalizeSong({
    bars: 1,
    tracks: [
      { name: 'Kit', instrument: 'kit-acoustic', notes: [{ pitch: 'ride', start: 0, length: 1, velocity: 1 }, { pitch: 'C4', start: 2, length: 1, velocity: 1 }] },
      { name: 'Upright', instrument: 'upright-bass', notes: [{ pitch: 'C2', start: 0, length: 4, velocity: 1 }, { pitch: 'G2', start: 0, length: 4, velocity: 1 }] },
      { name: 'Piano', instrument: 'piano', notes: [{ pitch: 'C4', start: 0, length: 4, velocity: 1 }, { pitch: 'E4', start: 0, length: 4, velocity: 1 }] },
      { name: 'Old', instrument: 'pad', notes: [] }
    ]
  })

  it('keeps instruments, treats kits as drums and sampled basses as one note at a time', () => {
    expect(song.tracks.map((t) => t.instrument)).toEqual(['kit-acoustic', 'upright-bass', 'piano', 'pad'])
    expect(song.tracks[0].notes.map((n) => n.pitch)).toEqual(['ride'])
    expect(song.tracks[1].notes.map((n) => n.pitch)).toEqual(['C2'])
    expect(song.tracks[2].notes).toHaveLength(2)
  })

  it('exports kits on the drum channel and sampled instruments with their GM program', () => {
    const bytes = Array.from(songToMidi(song))
    const hasSeq = (seq: number[]) => bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b))
    expect(hasSeq([0x99, 51])).toBe(true) // ride on channel 10
    expect(hasSeq([0xc0, GM_NAMES.indexOf('acoustic_bass')])).toBe(true)
    expect(hasSeq([0xc1, GM_NAMES.indexOf('acoustic_grand_piano')])).toBe(true)
  })

  it('lets the composer choose every instrument', () => {
    const guide = instrumentGuide()
    for (const id of INSTRUMENTS) expect(guide).toContain(`${id} (`)
    const tracks = SONG_RESPONSE_SCHEMA.properties.song.properties.tracks
    expect(tracks.items.properties.instrument.enum).toEqual([...INSTRUMENTS])
  })
})

import { pitchToMidi, STEPS_PER_BAR, type DrumSound, type Song } from './song'

// Minimal Standard MIDI File (format 1) writer. 96 ticks per quarter note,
// so one 16th step = 24 ticks.

const PPQ = 96
const TICKS_PER_STEP = PPQ / 4

// General MIDI percussion map (channel 10).
const GM_DRUMS: Record<DrumSound, number> = {
  kick: 36, snare: 38, clap: 39, hat: 42, openhat: 46, tom: 45, rim: 37
}

// General MIDI programs per instrument.
const GM_PROGRAM = { bass: 38, lead: 81, pad: 89, pluck: 45, keys: 4 } as const

function vlq(n: number): number[] {
  const bytes = [n & 0x7f]
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80)
  return bytes
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number) => [(n >> 8) & 255, n & 255]
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f)

function chunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...u32(data.length), ...data]
}

interface Ev { tick: number; order: number; bytes: number[] }

function trackChunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const data: number[] = []
  let last = 0
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.bytes)
    last = e.tick
  }
  data.push(0, 0xff, 0x2f, 0) // end of track
  return chunk('MTrk', data)
}

/** Render the loop `repeats` times into a .mid file. */
export function songToMidi(song: Song, repeats = 1): Uint8Array {
  const loopTicks = song.bars * STEPS_PER_BAR * TICKS_PER_STEP
  const tracks: number[][] = []

  // Conductor track: tempo + name + 4/4.
  const usPerQuarter = Math.round(60_000_000 / song.bpm)
  const title = ascii(song.title)
  tracks.push(
    trackChunk([
      { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(title.length), ...title] },
      { tick: 0, order: 1, bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] },
      { tick: 0, order: 2, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] }
    ])
  )

  let nextChannel = 0
  for (const t of song.tracks) {
    if (t.muted) continue
    const drums = t.instrument === 'drums'
    let ch = 9
    if (!drums) {
      ch = nextChannel++
      if (ch >= 9) ch++ // skip the drum channel
      if (ch > 15) break
    }
    const name = ascii(t.name)
    const events: Ev[] = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] }]
    if (!drums) events.push({ tick: 0, order: 1, bytes: [0xc0 | ch, GM_PROGRAM[t.instrument as keyof typeof GM_PROGRAM]] })
    events.push({ tick: 0, order: 2, bytes: [0xb0 | ch, 7, Math.round(t.volume * 127)] })

    for (let r = 0; r < repeats; r++) {
      for (const n of t.notes) {
        const key = drums ? GM_DRUMS[n.pitch as DrumSound] : pitchToMidi(n.pitch)
        if (key == null || key < 0 || key > 127) continue
        const on = r * loopTicks + n.start * TICKS_PER_STEP
        const off = on + (drums ? TICKS_PER_STEP / 2 : n.length * TICKS_PER_STEP)
        const vel = Math.max(1, Math.round(n.velocity * 127))
        // order: note-offs before note-ons at the same tick so retriggers work.
        events.push({ tick: on, order: 4, bytes: [0x90 | ch, key, vel] })
        events.push({ tick: off, order: 3, bytes: [0x80 | ch, key, 0] })
      }
    }
    tracks.push(trackChunk(events))
  }

  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)])
  return new Uint8Array([...header, ...tracks.flat()])
}

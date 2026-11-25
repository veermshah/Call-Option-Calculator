import { describe, expect, it } from 'vitest'
import { encodeWav } from '../src/renderer/src/lib/wav'

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo header and interleaved samples', () => {
    const left = new Float32Array([0, 1, -1])
    const right = new Float32Array([0.5, -0.5, 2])
    const bytes = encodeWav([left, right], 44100)
    const v = new DataView(bytes.buffer)
    const text = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4))
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(44100)
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2)
    expect(bytes.length).toBe(44 + 12)
    expect(v.getInt16(44, true)).toBe(0)
    expect(v.getInt16(46, true)).toBe(16383)
    expect(v.getInt16(48, true)).toBe(0x7fff)
    expect(v.getInt16(52, true)).toBe(-0x8000)
    // out-of-range samples are clamped
    expect(v.getInt16(54, true)).toBe(0x7fff)
  })
})

import type { Instrument } from '@shared/song'

const COLORS: Record<Instrument, string> = {
  drums: '#f2a541',
  bass: '#5b8def',
  lead: '#e8577a',
  pad: '#9b7bea',
  pluck: '#3cc6a6',
  keys: '#e6d36a'
}

export const colorFor = (i: Instrument) => COLORS[i] ?? '#aaa'

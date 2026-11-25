import type { Category } from '@shared/instruments'
import { instrumentDef } from '@shared/instruments'

// The original synths keep their own colours; everything else is coloured by family.
const BY_ID: Record<string, string> = {
  drums: '#f2a541',
  bass: '#5b8def',
  lead: '#e8577a',
  pad: '#9b7bea',
  pluck: '#3cc6a6',
  keys: '#e6d36a'
}

const BY_CATEGORY: Record<Category, string> = {
  Drums: '#f2a541',
  Bass: '#5b8def',
  Keys: '#e6d36a',
  Organ: '#d9a05b',
  Mallets: '#6fd0e0',
  Guitar: '#e47a4f',
  Strings: '#c770d8',
  Brass: '#e9c04a',
  Woodwinds: '#8fd16a',
  Voices: '#f08fb5',
  Synths: '#9b7bea',
  World: '#4fc1a0'
}

export const colorFor = (id: string) => BY_ID[id] ?? BY_CATEGORY[instrumentDef(id).category] ?? '#aaa'

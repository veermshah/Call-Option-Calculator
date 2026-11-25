import { normalizeSong, type Song } from '@shared/song'
import type { ChatTurn } from '@shared/ipc'

// Keeps the song you're working on in this browser/app so a refresh or a
// restart never loses it. Storage can be blocked (private windows), so every
// access is guarded and the app works without it.

const KEY = 'riff.autosave.v1'

export interface Saved {
  song: Song
  turns: ChatTurn[]
}

export function loadAutosave(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { song?: unknown; turns?: unknown }
    const turns = Array.isArray(data.turns)
      ? data.turns.filter(
          (t): t is ChatTurn =>
            !!t && typeof t === 'object' && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string'
        )
      : []
    return { song: normalizeSong(data.song), turns: turns.slice(-40) }
  } catch {
    return null
  }
}

export function writeAutosave(saved: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ song: saved.song, turns: saved.turns.slice(-40) }))
    return true
  } catch {
    return false
  }
}

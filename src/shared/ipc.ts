import type { Song } from './song'
import type { LyricsRequest, LyricsResult } from './lyrics'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ComposeRequest {
  prompt: string
  /** The song as it is now; Claude edits it rather than starting over. */
  song: Song
  /** Recent conversation, oldest first, for context. */
  history: ChatTurn[]
  /** Tracks the musician played by hand; Claude must leave them untouched. */
  lockedTrackIds?: string[]
}

export type ComposeResult =
  | { ok: true; song: Song; message: string }
  | { ok: false; error: string }

export interface Settings {
  hasApiKey: boolean
  model: string
}

export interface RiffApi {
  compose(req: ComposeRequest): Promise<ComposeResult>
  cancelCompose(): Promise<void>
  writeLyrics(req: LyricsRequest): Promise<LyricsResult>
  onComposeProgress(cb: (chars: number) => void): () => void
  getSettings(): Promise<Settings>
  setApiKey(key: string): Promise<Settings>
  setModel(model: string): Promise<Settings>
  saveProject(song: Song): Promise<string | null>
  openProject(): Promise<Song | null>
  exportMidi(bytes: Uint8Array, suggestedName: string): Promise<string | null>
  exportAudio(bytes: Uint8Array, suggestedName: string): Promise<string | null>
}

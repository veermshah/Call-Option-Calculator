import type { ComposeRequest, ComposeResult, RiffApi, Settings } from '@shared/ipc'
import { normalizeSong, type Song } from '@shared/song'

// In Electron the preload script exposes `window.riff`, backed by the main
// process. In a plain browser (the Vercel deployment) we provide the same API
// here: the visitor's key stays in their browser's localStorage and requests
// go straight from the browser to api.anthropic.com.

const KEY = 'riff.apiKey'
const MODEL = 'riff.model'
const DEFAULT_MODEL = 'claude-opus-5-5'

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v) localStorage.setItem(k, v)
      else localStorage.removeItem(k)
    } catch {
      /* storage blocked: settings just won't persist */
    }
  }
}

let sessionKey: string | null = null
const getKey = () => store.get(KEY) ?? sessionKey
const settings = (): Settings => ({ hasApiKey: !!getKey(), model: store.get(MODEL) || DEFAULT_MODEL })

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeName = (name: string) => name.replace(/[^\w\- ]+/g, '').trim() || 'untitled'

function createWebApi(): RiffApi {
  const listeners = new Set<(n: number) => void>()
  let active: AbortController | null = null

  return {
    async compose(req: ComposeRequest): Promise<ComposeResult> {
      const apiKey = getKey()
      if (!apiKey) return { ok: false, error: 'Add your Anthropic API key in Settings first.' }
      active?.abort()
      const ctrl = new AbortController()
      active = ctrl
      const { compose } = await import('@shared/composer')
      const res = await compose(
        apiKey,
        settings().model,
        { ...req, song: normalizeSong(req.song) },
        (n) => listeners.forEach((l) => l(n)),
        ctrl.signal,
        { browser: true }
      )
      if (active === ctrl) active = null
      return res
    },
    async writeLyrics(req) {
      const apiKey = getKey()
      if (!apiKey) return { ok: false, error: 'Add your Anthropic API key in Settings first.' }
      active?.abort()
      const ctrl = new AbortController()
      active = ctrl
      const { writeLyrics } = await import('@shared/lyrics')
      const res = await writeLyrics(
        apiKey,
        settings().model,
        { ...req, song: normalizeSong(req.song) },
        (n) => listeners.forEach((l) => l(n)),
        ctrl.signal,
        { browser: true }
      )
      if (active === ctrl) active = null
      return res
    },
    async cancelCompose() {
      active?.abort()
    },
    onComposeProgress(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async getSettings() {
      return settings()
    },
    async setApiKey(key: string) {
      const k = key.trim() || null
      sessionKey = k
      store.set(KEY, k)
      return settings()
    },
    async setModel(model: string) {
      store.set(MODEL, model.trim() || null)
      return settings()
    },
    async saveProject(song: Song) {
      const name = `${safeName(song.title)}.riff.json`
      download(JSON.stringify(normalizeSong(song), null, 2), 'application/json', name)
      return name
    },
    openProject() {
      return new Promise<Song | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          try {
            resolve(normalizeSong(JSON.parse(await file.text())))
          } catch {
            resolve(null)
          }
        }
        input.click()
      })
    },
    async exportMidi(bytes: Uint8Array, suggestedName: string) {
      const name = `${safeName(suggestedName)}.mid`
      download(new Uint8Array(bytes), "audio/midi", name)
      return name
    },
    async exportAudio(bytes: Uint8Array, suggestedName: string) {
      const name = `${safeName(suggestedName)}.wav`
      download(new Uint8Array(bytes), 'audio/wav', name)
      return name
    }
  }
}

export const isDesktop = typeof window !== 'undefined' && !!window.riff
export const api: RiffApi = isDesktop ? window.riff : createWebApi()

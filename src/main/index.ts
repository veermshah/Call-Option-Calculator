import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compose, DEFAULT_MODEL } from '@shared/composer'
import { writeLyrics, type LyricsRequest } from '@shared/lyrics'
import { normalizeSong, type Song } from '@shared/song'
import type { ComposeRequest, Settings } from '@shared/ipc'


// ---------------------------------------------------------------------------
// Settings: the API key is encrypted with the OS keychain when available.
// ---------------------------------------------------------------------------

interface StoredSettings {
  apiKey?: string // base64 of safeStorage-encrypted bytes, or plain text if encryption is unavailable
  encrypted?: boolean
  model?: string
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

function loadStored(): StoredSettings {
  try {
    return existsSync(settingsPath()) ? JSON.parse(readFileSync(settingsPath(), 'utf8')) : {}
  } catch {
    return {}
  }
}

function saveStored(s: StoredSettings) {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 })
}

function getApiKey(): string | null {
  const s = loadStored()
  if (s.apiKey) {
    try {
      return s.encrypted ? safeStorage.decryptString(Buffer.from(s.apiKey, 'base64')) : s.apiKey
    } catch {
      return null
    }
  }
  return process.env.ANTHROPIC_API_KEY || null
}

function publicSettings(): Settings {
  return { hasApiKey: !!getApiKey(), model: loadStored().model || DEFAULT_MODEL }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'Riff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

let activeCompose: AbortController | null = null

ipcMain.handle('compose', async (event, req: ComposeRequest) => {
  const apiKey = getApiKey()
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key in Settings first.' }
  activeCompose?.abort()
  const ctrl = new AbortController()
  activeCompose = ctrl
  const result = await compose(
    apiKey,
    publicSettings().model,
    { ...req, song: normalizeSong(req.song) },
    (chars) => event.sender.send('compose-progress', chars),
    ctrl.signal
  )
  if (activeCompose === ctrl) activeCompose = null
  return result
})

ipcMain.handle('write-lyrics', async (event, req: LyricsRequest) => {
  const apiKey = getApiKey()
  if (!apiKey) return { ok: false, error: 'Add your Anthropic API key in Settings first.' }
  activeCompose?.abort()
  const ctrl = new AbortController()
  activeCompose = ctrl
  const result = await writeLyrics(
    apiKey,
    publicSettings().model,
    { ...req, song: normalizeSong(req.song) },
    (chars) => event.sender.send('compose-progress', chars),
    ctrl.signal
  )
  if (activeCompose === ctrl) activeCompose = null
  return result
})

ipcMain.handle('cancel-compose', () => {
  activeCompose?.abort()
})

ipcMain.handle('get-settings', () => publicSettings())

ipcMain.handle('set-api-key', (_e, key: string) => {
  const s = loadStored()
  const trimmed = key.trim()
  if (!trimmed) {
    delete s.apiKey
    delete s.encrypted
  } else if (safeStorage.isEncryptionAvailable()) {
    s.apiKey = safeStorage.encryptString(trimmed).toString('base64')
    s.encrypted = true
  } else {
    s.apiKey = trimmed
    s.encrypted = false
  }
  saveStored(s)
  return publicSettings()
})

ipcMain.handle('set-model', (_e, model: string) => {
  const s = loadStored()
  s.model = model.trim() || DEFAULT_MODEL
  saveStored(s)
  return publicSettings()
})

const safeName = (name: string) => name.replace(/[^\w\- ]+/g, '').trim() || 'untitled'

ipcMain.handle('save-project', async (e, song: Song) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showSaveDialog(win!, {
    defaultPath: `${safeName(song.title)}.riff.json`,
    filters: [{ name: 'Riff project', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, JSON.stringify(normalizeSong(song), null, 2))
  return res.filePath
})

ipcMain.handle('open-project', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'Riff project', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  try {
    return normalizeSong(JSON.parse(await readFile(res.filePaths[0], 'utf8')))
  } catch {
    return null
  }
})

ipcMain.handle('export-midi', async (e, bytes: Uint8Array, suggestedName: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showSaveDialog(win!, {
    defaultPath: `${safeName(suggestedName)}.mid`,
    filters: [{ name: 'MIDI', extensions: ['mid'] }]
  })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, Buffer.from(bytes))
  return res.filePath
})

ipcMain.handle('export-audio', async (e, bytes: Uint8Array, suggestedName: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showSaveDialog(win!, {
    defaultPath: `${safeName(suggestedName)}.wav`,
    filters: [{ name: 'WAV audio', extensions: ['wav'] }]
  })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, Buffer.from(bytes))
  return res.filePath
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

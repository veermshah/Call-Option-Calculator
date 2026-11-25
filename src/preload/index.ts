import { contextBridge, ipcRenderer } from 'electron'
import type { RiffApi } from '../shared/ipc'

const api: RiffApi = {
  compose: (req) => ipcRenderer.invoke('compose', req),
  cancelCompose: () => ipcRenderer.invoke('cancel-compose'),
  writeLyrics: (req) => ipcRenderer.invoke('write-lyrics', req),
  onComposeProgress: (cb) => {
    const listener = (_e: unknown, chars: number) => cb(chars)
    ipcRenderer.on('compose-progress', listener)
    return () => ipcRenderer.removeListener('compose-progress', listener)
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  setModel: (model) => ipcRenderer.invoke('set-model', model),
  saveProject: (song) => ipcRenderer.invoke('save-project', song),
  openProject: () => ipcRenderer.invoke('open-project'),
  exportMidi: (bytes, name) => ipcRenderer.invoke('export-midi', bytes, name),
  exportAudio: (bytes, name) => ipcRenderer.invoke('export-audio', bytes, name)
}

contextBridge.exposeInMainWorld('riff', api)

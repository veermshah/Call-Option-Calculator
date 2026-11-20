import { useCallback, useEffect, useRef, useState } from 'react'
import { emptySong, newId, normalizeSong, type Note, type Song, type Track } from '@shared/song'
import { songToMidi } from '@shared/midi'
import type { ChatTurn, Settings } from '@shared/ipc'
import { Engine } from './lib/engine'
import { useHistory } from './lib/useHistory'
import { ChatPanel } from './components/ChatPanel'
import { TrackRow } from './components/TrackRow'
import { SettingsModal } from './components/SettingsModal'

type Turn = ChatTurn & { error?: boolean }

export default function App() {
  const history = useHistory<Song>(emptySong())
  const song = history.present
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [settings, setSettings] = useState<Settings>({ hasApiKey: true, model: '' })
  const [showSettings, setShowSettings] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playStep, setPlayStep] = useState(-1)
  const [selected, setSelected] = useState<string | null>(null)
  const [solo, setSolo] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const engine = useRef<Engine | null>(null)

  // Engine lifecycle
  useEffect(() => {
    const e = new Engine()
    e.onStep = setPlayStep
    engine.current = e
    return () => e.dispose()
  }, [])

  useEffect(() => {
    engine.current?.setSong(song)
  }, [song])

  useEffect(() => {
    engine.current?.setSolo(solo)
  }, [solo])

  useEffect(() => {
    window.riff.getSettings().then(setSettings)
    return window.riff.onComposeProgress(setProgress)
  }, [])

  const flash = (msg: string) => {
    setStatus(msg)
    window.setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 3000)
  }

  const togglePlay = useCallback(async () => {
    const e = engine.current
    if (!e) return
    if (e.playing) {
      e.stop()
      setPlaying(false)
    } else {
      await e.play()
      setPlaying(true)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select')
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        togglePlay()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, history])

  const updateSong = (patch: Partial<Song>, record = true) => {
    const next = normalizeSong({ ...song, ...patch })
    if (record) history.set(next)
    else history.replace(next)
  }

  const updateTrack = (id: string, patch: Partial<Track>, record = true) => {
    const tracks = song.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t))
    if (record) history.set({ ...song, tracks })
    else history.replace({ ...song, tracks })
  }

  const addTrack = () => {
    const t: Track = { id: newId(), name: `Track ${song.tracks.length + 1}`, instrument: 'keys', volume: 0.8, muted: false, notes: [] }
    history.set({ ...song, tracks: [...song.tracks, t] })
    setSelected(t.id)
  }

  const deleteTrack = (id: string) => {
    history.set({ ...song, tracks: song.tracks.filter((t) => t.id !== id) })
    if (solo === id) setSolo(null)
  }

  const send = async (prompt: string) => {
    const priorTurns = turns.filter((t) => !t.error)
    setTurns((t) => [...t, { role: 'user', text: prompt }])
    setBusy(true)
    setProgress(0)
    const res = await window.riff.compose({ prompt, song, history: priorTurns.map(({ role, text }) => ({ role, text })) })
    setBusy(false)
    if (res.ok) {
      history.set(res.song)
      setTurns((t) => [...t, { role: 'assistant', text: res.message }])
      if (!selected || !res.song.tracks.some((t) => t.id === selected)) setSelected(res.song.tracks[0]?.id ?? null)
      if (!engine.current?.playing) {
        await engine.current?.play()
        setPlaying(true)
      }
    } else {
      setTurns((t) => [...t, { role: 'assistant', text: res.error, error: true }])
    }
  }

  const save = async () => {
    const path = await window.riff.saveProject(song)
    if (path) flash(`Saved ${path}`)
  }

  const open = async () => {
    const s = await window.riff.openProject()
    if (s) {
      history.set(s)
      setSelected(s.tracks[0]?.id ?? null)
      flash(`Opened “${s.title}”`)
    }
  }

  const exportMidi = async () => {
    const path = await window.riff.exportMidi(songToMidi(song, 4), song.title)
    if (path) flash(`Exported ${path}`)
  }

  const preview = (trackId: string, note: Note) => engine.current?.preview(trackId, note)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Riff</div>
        <button className={`play${playing ? ' on' : ''}`} onClick={togglePlay} title="Play / stop (Space)">
          {playing ? '■' : '▶'}
        </button>
        <input className="title" value={song.title} onChange={(e) => updateSong({ title: e.target.value }, false)} />
        <label className="field">
          BPM
          <input type="number" min={40} max={220} value={song.bpm} onChange={(e) => updateSong({ bpm: +e.target.value })} />
        </label>
        <label className="field">
          Key
          <input className="key" value={song.key} onChange={(e) => updateSong({ key: e.target.value }, false)} />
        </label>
        <label className="field">
          Bars
          <select value={song.bars} onChange={(e) => updateSong({ bars: +e.target.value })}>
            {[1, 2, 4, 8, 16].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Swing
          <input type="range" min={0} max={0.5} step={0.01} value={song.swing} onChange={(e) => updateSong({ swing: +e.target.value }, false)} />
        </label>
        <span className="spacer" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button onClick={open}>Open</button>
        <button onClick={save}>Save</button>
        <button onClick={exportMidi} disabled={!song.tracks.length}>Export MIDI</button>
        <button className="icon" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
      </header>

      <div className="body">
        <ChatPanel
          turns={turns}
          busy={busy}
          progress={progress}
          hasApiKey={settings.hasApiKey}
          hasSong={song.tracks.length > 0}
          onSend={send}
          onCancel={() => window.riff.cancelCompose()}
          onOpenSettings={() => setShowSettings(true)}
        />
        <main className="arrange">
          {song.tracks.length === 0 ? (
            <div className="empty">
              <h1>Start with a sentence.</h1>
              <p>Ask the composer for a beat, a mood or a genre, or add a track and draw notes yourself.</p>
              <button onClick={addTrack}>+ Add empty track</button>
            </div>
          ) : (
            <>
              {song.tracks.map((t) => (
                <TrackRow
                  key={t.id}
                  track={t}
                  bars={song.bars}
                  playStep={playStep}
                  selected={selected === t.id}
                  soloed={solo === t.id}
                  onSelect={() => setSelected(selected === t.id ? null : t.id)}
                  onUpdate={(patch, record) => updateTrack(t.id, patch, record)}
                  onDelete={() => deleteTrack(t.id)}
                  onSolo={() => setSolo(solo === t.id ? null : t.id)}
                  onPreview={(n) => preview(t.id, n)}
                />
              ))}
              <button className="add-track" onClick={addTrack}>+ Add track</button>
            </>
          )}
        </main>
      </div>

      {status && <div className="status">{status}</div>}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s)
            setShowSettings(false)
          }}
        />
      )}
    </div>
  )
}

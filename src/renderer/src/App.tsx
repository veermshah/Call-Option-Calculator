import { useCallback, useEffect, useRef, useState } from 'react'
import { emptySong, newId, normalizeSong, type Note, type Song, type Track } from '@shared/song'
import { songToMidi } from '@shared/midi'
import type { ChatTurn, Settings } from '@shared/ipc'
import { Engine, renderSong } from './lib/engine'
import { useHistory } from './lib/useHistory'
import { loadAutosave, writeAutosave } from './lib/autosave'
import { demoSong } from './lib/demo'
import { encodeWav } from './lib/wav'
import { ChatPanel } from './components/ChatPanel'
import { TrackRow } from './components/TrackRow'
import { SettingsModal } from './components/SettingsModal'
import { KeyboardPanel } from './components/KeyboardPanel'
import { LyricsPanel } from './components/LyricsPanel'
import { StartScreen } from './components/StartScreen'
import { SongSettings } from './components/SongSettings'
import { Popover } from './components/Popover'
import { api } from './lib/api'

type Turn = ChatTurn & { error?: boolean }

export default function App() {
  const [restored] = useState(loadAutosave)
  const history = useHistory<Song>(restored?.song ?? emptySong())
  const song = history.present
  const [turns, setTurns] = useState<Turn[]>(restored?.turns ?? [])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [settings, setSettings] = useState<Settings>({ hasApiKey: true, model: '' })
  // 'setup' is the first-run key step, opened when you try to create without a key.
  const [showSettings, setShowSettings] = useState<false | 'settings' | 'setup'>(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playStep, setPlayStep] = useState(-1)
  const [selected, setSelected] = useState<string | null>(null)
  const [solo, setSolo] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [tab, setTab] = useState<'arrange' | 'lyrics'>('arrange')
  const [recording, setRecording] = useState(false)
  const engine = useRef<Engine | null>(null)

  // Engine lifecycle
  useEffect(() => {
    const e = new Engine()
    e.onStep = setPlayStep
    engine.current = e
    // Start audio on the first click or key press anywhere, so it is already
    // running by the time the first note is played.
    const unlock = () => e.unlock()
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      e.dispose()
    }
  }, [])

  useEffect(() => {
    engine.current?.setSong(song)
  }, [song])

  useEffect(() => {
    engine.current?.setSolo(solo)
  }, [solo])

  useEffect(() => {
    api.getSettings().then(setSettings)
    return api.onComposeProgress(setProgress)
  }, [])

  // Autosave: the song and the conversation survive a refresh or restart.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (writeAutosave({ song, turns: turns.filter((t) => !t.error).map(({ role, text }) => ({ role, text })) })) setSavedAt(Date.now())
    }, 400)
    return () => window.clearTimeout(id)
  }, [song, turns])

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
      setRecording(false)
    } else {
      await e.play()
      setPlaying(true)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select')
      if (e.key === 'Escape' && typing) {
        ;(e.target as HTMLElement).blur()
      } else if (e.code === 'Backquote' && !typing) {
        e.preventDefault()
        setShowKeys((v) => !v)
      } else if (e.code === 'Space' && !typing) {
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
    const t: Track = { id: newId(), name: `Track ${song.tracks.length + 1}`, instrument: 'keys', volume: 0.8, muted: false, locked: false, notes: [] }
    history.set({ ...song, tracks: [...song.tracks, t] })
    setSelected(t.id)
  }

  const deleteTrack = (id: string) => {
    history.set({ ...song, tracks: song.tracks.filter((t) => t.id !== id) })
    if (solo === id) setSolo(null)
  }

  // While the keyboard is open it always needs a track to play into: keep the
  // last one if the selection is cleared, otherwise make one.
  const lastKeyTarget = useRef<string | null>(null)
  useEffect(() => {
    if (!showKeys) {
      setRecording(false)
      return
    }
    if (selected && song.tracks.some((t) => t.id === selected)) {
      lastKeyTarget.current = selected
      return
    }
    if (lastKeyTarget.current && song.tracks.some((t) => t.id === lastKeyTarget.current)) {
      setSelected(lastKeyTarget.current)
      return
    }
    const t: Track = { id: newId(), name: 'My Part', instrument: 'keys', volume: 0.8, muted: false, locked: true, notes: [] }
    history.set({ ...song, tracks: [t, ...song.tracks] })
    setSelected(t.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showKeys, selected])

  const keyTarget = song.tracks.find((t) => t.id === selected) ?? null

  const toggleRecord = async () => {
    if (recording) return setRecording(false)
    if (!engine.current?.playing) {
      await engine.current?.play()
      setPlaying(true)
    }
    setRecording(true)
  }

  const recordNotes = (trackId: string, notes: Note[]) => {
    history.set((prev) =>
      normalizeSong({
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === trackId ? { ...t, locked: true, notes: [...t.notes.filter((n) => !notes.some((m) => m.pitch === n.pitch && m.start === n.start)), ...notes] } : t
        )
      })
    )
  }

  const buildBand = () => {
    if (!keyTarget) return
    setRecording(false)
    const others = song.tracks.filter((t) => t.id !== keyTarget.id && t.notes.length)
    send(
      others.length
        ? `Rework the other parts so they fit my played part "${keyTarget.name}" closely. Keep my part exactly as played.`
        : `I played "${keyTarget.name}" myself. Build a full band around it: drums, a bassline that follows my harmony, and one or two more parts that complement it. Keep my part exactly as played, and pick a tempo-appropriate groove for ${song.bpm} bpm.`
    )
  }

  const singIt = () => {
    setTab('arrange')
    const hasVocal = song.tracks.some((t) => t.name.toLowerCase() === 'vocal')
    send(
      `${hasVocal ? 'Rewrite' : 'Add'} a "Vocal" track: a singable melody for the chorus of my lyrics (or the first section if there's no chorus), one note per syllable. Keep the other parts as they are, just repeat them if the loop needs to get longer.`
    )
  }

  const send = async (prompt: string, keyJustAdded = false) => {
    if (!settings.hasApiKey && !keyJustAdded) {
      // Ask for the key at the moment it's needed, then carry on with this prompt.
      setPendingPrompt(prompt)
      setShowSettings('setup')
      return
    }
    setTab('arrange')
    const priorTurns = turns.filter((t) => !t.error)
    setTurns((t) => [...t, { role: 'user', text: prompt }])
    setBusy(true)
    setProgress(0)
    const res = await api.compose({
      prompt,
      song,
      history: priorTurns.map(({ role, text }) => ({ role, text })),
      lockedTrackIds: song.tracks.filter((t) => t.locked).map((t) => t.id)
    })
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
    const path = await api.saveProject(song)
    if (path) flash(`Saved ${path}`)
  }

  const open = async () => {
    const s = await api.openProject()
    if (s) {
      history.set(s)
      setSelected(s.tracks[0]?.id ?? null)
      flash(`Opened “${s.title}”`)
    }
  }

  const exportMidi = async () => {
    const path = await api.exportMidi(songToMidi(song, 4), song.title)
    if (path) flash(`Exported ${path}`)
  }

  const exportAudio = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { channels, sampleRate } = await renderSong(song, 4)
      const path = await api.exportAudio(encodeWav(channels, sampleRate), song.title)
      if (path) flash(`Exported ${path}`)
    } catch (err) {
      console.error(err)
      flash('Could not render audio. Try Download MIDI instead.')
    } finally {
      setExporting(false)
    }
  }

  const startPlaying = async () => {
    if (!engine.current?.playing) {
      await engine.current?.play()
      setPlaying(true)
    }
  }

  const loadDemo = async () => {
    const s = demoSong()
    history.set(s)
    setTurns([])
    setSelected(s.tracks[0]?.id ?? null)
    setTab('arrange')
    engine.current?.setSong(s)
    await startPlaying()
  }

  const newSong = () => {
    engine.current?.stop()
    setPlaying(false)
    setRecording(false)
    setShowKeys(false)
    history.set(emptySong())
    setTurns([])
    setSelected(null)
    setSolo(null)
    setTab('arrange')
    flash('New song. Undo (Ctrl+Z) brings the last one back.')
  }

  const preview = (trackId: string, note: Note) => engine.current?.preview(trackId, note)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Riff</div>
        <button className={`play${playing ? ' on' : ''}`} onClick={togglePlay} title="Play / stop (Space)" disabled={!song.tracks.length && !showKeys}>
          {playing ? '■' : '▶'}
        </button>
        <input className="title" value={song.title} onChange={(e) => updateSong({ title: e.target.value }, false)} aria-label="Song title" />
        {song.tracks.length > 0 && savedAt && <span className="saved" title="Your song is saved in this browser automatically">✓ Saved</span>}
        <SongSettings song={song} onChange={updateSong} />
        <span className="spacer" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button className={showKeys ? 'on' : ''} onClick={() => setShowKeys((v) => !v)} title="Play with your keyboard (`)">🎹 Keys</button>
        <button onClick={newSong} disabled={!song.tracks.length && !turns.length} title="Start a new song">+ New</button>
        <Popover className={song.tracks.length ? 'primary' : ''} label={exporting ? 'Rendering…' : 'Export ▾'} align="right" title="Download or save your song">
          {(close) => (
            <div className="menu">
              <button disabled={!song.tracks.length || exporting} onClick={() => { close(); exportAudio() }}>
                <strong>Download audio</strong><span>WAV, 4 loops, ready to share</span>
              </button>
              <button disabled={!song.tracks.length} onClick={() => { close(); exportMidi() }}>
                <strong>Download MIDI</strong><span>Open the notes in GarageBand, Ableton, FL…</span>
              </button>
              <button disabled={!song.tracks.length} onClick={() => { close(); save() }}>
                <strong>Save project file</strong><span>Keep a copy you can reopen in Riff</span>
              </button>
              <hr />
              <button onClick={() => { close(); open() }}>
                <strong>Open project file…</strong>
              </button>
            </div>
          )}
        </Popover>
        <button className="icon" onClick={() => setShowSettings('settings')} title="Settings">⚙</button>
      </header>

      <div className="body">
        <ChatPanel
          turns={turns}
          busy={busy}
          progress={progress}
          hasSong={song.tracks.length > 0}
          onSend={(p) => send(p)}
          onCancel={() => api.cancelCompose()}
        />
        <div className="main-col">
        <nav className="tabs">
          <button className={tab === 'arrange' ? 'on' : ''} onClick={() => setTab('arrange')}>Arrange</button>
          <button className={tab === 'lyrics' ? 'on' : ''} onClick={() => setTab('lyrics')}>
            Lyrics{song.lyrics.trim() ? ' •' : ''}
          </button>
        </nav>
        {tab === 'lyrics' ? (
          <LyricsPanel
            song={song}
            canCompose={settings.hasApiKey}
            composing={busy}
            onType={(lyrics) => history.replace({ ...song, lyrics })}
            onAccept={(lyrics) => history.set({ ...song, lyrics })}
            onSingIt={singIt}
            onOpenSettings={() => setShowSettings('settings')}
          />
        ) : (<>
        {showKeys && (
          <KeyboardPanel
            song={song}
            target={keyTarget}
            engine={engine.current}
            playing={playing}
            recording={recording}
            busy={busy}
            canCompose
            onToggleRecord={toggleRecord}
            onRecordNotes={recordNotes}
            onClear={(id) => updateTrack(id, { notes: [] })}
            onBuildBand={buildBand}
            onClose={() => setShowKeys(false)}
          />
        )}
        <main className="arrange">
          {song.tracks.length === 0 ? (
            <StartScreen
              busy={busy}
              progress={progress}
              error={turns.at(-1)?.error ? turns.at(-1)!.text : null}
              onCreate={(p) => send(p)}
              onCancel={() => api.cancelCompose()}
              onPlayKeys={() => setShowKeys(true)}
              onDemo={loadDemo}
              onBlank={addTrack}
              onOpen={open}
            />
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
        </>)}
        </div>
      </div>

      {exporting ? (
        <div className="status"><span className="spinner" /> Rendering your song to audio…</div>
      ) : (
        status && <div className="status">{status}</div>
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          setup={showSettings === 'setup'}
          onClose={() => {
            setShowSettings(false)
            setPendingPrompt(null)
          }}
          onSaved={(s) => {
            setSettings(s)
            setShowSettings(false)
            const p = pendingPrompt
            setPendingPrompt(null)
            if (p && s.hasApiKey) send(p, true)
          }}
        />
      )}
    </div>
  )
}

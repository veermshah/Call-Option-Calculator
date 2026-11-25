import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { DEFAULT_TUNE, emptySong, newId, normalizeSong, type Note, type Song, type Track, type TuneSettings, type VocalTake, type VoiceId } from '@shared/song'
import { tuneContext, vocalMelody } from '@shared/vocals/tune'
import { VOICE_PRESETS } from '@shared/vocals/sing'
import { buildScore, guessAlignment, leadInStart, type Syllable } from '@shared/vocals/score'
import { songToMidi } from '@shared/midi'
import type { ChatTurn, Settings } from '@shared/ipc'
import { Engine, renderSong, type VocalAudio } from './lib/engine'
import { getAudio, getValue, pruneVocals, putAudio, putValue } from './lib/vocalStore'
import { autotuneTake, singScore } from './lib/vocals'
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
import { VocalPanel } from './components/VocalPanel'
import { VocalRow } from './components/VocalRow'
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
  const [showVocals, setShowVocals] = useState(false)
  const [vocalAudio, setVocalAudio] = useState<Record<string, VocalAudio>>({})
  /** What the vocal engine is doing right now ('' when idle), and for which take. */
  const [vocalWork, setVocalWork] = useState<{ text: string; takeId?: string }>({ text: '' })
  const pendingSing = useRef<VoiceId | null>(null)
  const vocalJob = useRef(0)
  const engine = useRef<Engine | null>(null)
  const songRef = useRef(song)
  songRef.current = song

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

  // Vocal audio is kept in IndexedDB; load what the restored song needs.
  useEffect(() => {
    const ids = song.vocals.map((v) => v.id)
    void Promise.all(ids.map(async (id) => [id, await getAudio(`${id}:out`)] as const)).then((loaded) => {
      const found: Record<string, VocalAudio> = {}
      for (const [id, audio] of loaded) if (audio) found[id] = audio
      for (const [id, audio] of Object.entries(found)) engine.current?.setVocalAudio(id, audio)
      setVocalAudio((prev) => ({ ...found, ...prev }))
      void pruneVocals(ids)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const writeMelodyAndSing = (voice: VoiceId) => {
    pendingSing.current = voice
    singIt()
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
      const { channels, sampleRate } = await renderSong(song, 4, vocalAudio)
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
    setShowVocals(false)
    history.set(emptySong())
    setTurns([])
    setSelected(null)
    setSolo(null)
    setTab('arrange')
    flash('New song. Undo (Ctrl+Z) brings the last one back.')
  }

  const preview = (trackId: string, note: Note) => engine.current?.preview(trackId, note)

  // ---------------------------------------------------------------------------
  // Vocals
  // ---------------------------------------------------------------------------

  const setTakeAudio = (id: string, audio: VocalAudio) => {
    engine.current?.setVocalAudio(id, audio)
    setVocalAudio((prev) => ({ ...prev, [id]: audio }))
    void putAudio(`${id}:out`, audio)
  }

  /** Add a take and mute the synth guide melody so the voice is what you hear. */
  const addTake = (take: VocalTake) => {
    let mutedGuide = false
    history.set((prev) => {
      const guide = prev.tracks.find((t) => vocalMelody({ ...prev, tracks: [t] }).length && !t.muted)
      mutedGuide = !!guide
      return {
        ...prev,
        tracks: prev.tracks.map((t) => (t === guide ? { ...t, muted: true } : t)),
        vocals: [...prev.vocals.filter((v) => v.id !== take.id), take]
      }
    })
    setSelected(take.id)
    if (mutedGuide) flash('Muted the synth Vocal guide so you hear the voice. Unmute it on its track any time.')
  }

  const updateTake = (id: string, patch: Partial<VocalTake>, record = true) => {
    const vocals = song.vocals.map((v) => (v.id === id ? { ...v, ...patch } : v))
    if (record) history.set({ ...song, vocals })
    else history.replace({ ...song, vocals })
  }

  const deleteTake = (id: string) => {
    history.set({ ...song, vocals: song.vocals.filter((v) => v.id !== id) })
    if (solo === id) setSolo(null)
  }

  const onTake = async (samples: Float32Array, sampleRate: number) => {
    const s = songRef.current
    const id = `v${newId().slice(1)}`
    const n = s.vocals.filter((v) => v.kind === 'recorded').length + 1
    void putAudio(`${id}:raw`, { sampleRate, data: samples })
    const out = await autotuneTake(samples, tuneContext(s, 0, sampleRate), DEFAULT_TUNE)
    setTakeAudio(id, { sampleRate, data: out })
    addTake({
      id,
      name: `Take ${n}`,
      kind: 'recorded',
      start: 0,
      duration: samples.length / sampleRate,
      volume: 0.9,
      muted: false,
      tune: DEFAULT_TUNE
    })
  }

  // Retuning waits for the sliders to settle, then re-processes the original recording.
  const retuneTimer = useRef<Record<string, number>>({})
  const retune = (take: VocalTake, tune: TuneSettings) => {
    updateTake(take.id, { tune })
    window.clearTimeout(retuneTimer.current[take.id])
    retuneTimer.current[take.id] = window.setTimeout(async () => {
      const raw = await getAudio(`${take.id}:raw`)
      if (!raw) return flash('The original recording is not in this browser, so it cannot be retuned.')
      setVocalWork({ text: 'Retuning…', takeId: take.id })
      try {
        const latest = songRef.current.vocals.find((v) => v.id === take.id) ?? take
        const out = await autotuneTake(raw.data, tuneContext(songRef.current, latest.start, raw.sampleRate), tune)
        setTakeAudio(take.id, { sampleRate: raw.sampleRate, data: out })
      } finally {
        setVocalWork({ text: '' })
      }
    }, 350)
  }

  /** Sing stored syllables (or freshly fitted ones) on the current Vocal melody. */
  const singTake = async (voice: VoiceId, syllables: Syllable[], existing?: VocalTake) => {
    const s = songRef.current
    const melody = vocalMelody(s)
    const from = leadInStart(melody)
    const notes = buildScore(melody, syllables, s.bpm, from)
    if (!notes.length) throw new Error('There was nothing to sing. Check the lyrics and the Vocal track.')
    const sampleRate = Tone.getContext().sampleRate
    const data = await singScore(notes, sampleRate, voice)
    const id = existing?.id ?? `v${newId().slice(1)}`
    void putValue(`${id}:score`, syllables)
    setTakeAudio(id, { sampleRate, data })
    const name = existing?.name ?? `${VOICE_PRESETS[voice].label.split(' (')[0]} sings`
    const take: VocalTake = { ...(existing ?? { volume: 0.9, muted: false, tune: { ...DEFAULT_TUNE, on: false } }), id, name, kind: 'generated', start: from, duration: data.length / sampleRate, voice }
    if (existing) {
      history.set((prev) => ({ ...prev, vocals: prev.vocals.map((v) => (v.id === id ? take : v)) }))
    } else addTake(take)
  }

  const generateVocals = async (voice: VoiceId) => {
    const s = songRef.current
    const melody = vocalMelody(s)
    if (!melody.length || !s.lyrics.trim()) return
    const job = ++vocalJob.current
    setVocalWork({ text: 'Fitting your lyrics to the melody…' })
    let syllables: Syllable[]
    let note = ''
    if (settings.hasApiKey) {
      const res = await api.alignLyrics({ lyrics: s.lyrics, melody, song: s })
      if (job !== vocalJob.current) return
      if (res.ok) {
        syllables = res.syllables
        note = res.message
      } else {
        if (res.error === 'Cancelled.') return setVocalWork({ text: '' })
        syllables = guessAlignment(s.lyrics, melody)
        note = `Claude couldn't fit the words (${res.error}), so this is a rough guess at them.`
      }
    } else {
      syllables = guessAlignment(s.lyrics, melody)
      note = 'Sung with a rough guess at the words. Add your API key so Claude can fit them properly.'
    }
    setVocalWork({ text: 'Singing…' })
    try {
      await singTake(voice, syllables)
      if (note) flash(note)
      await startPlaying()
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      if (job === vocalJob.current) setVocalWork({ text: '' })
    }
  }

  const revoice = async (take: VocalTake, voice: VoiceId) => {
    const s = songRef.current
    const syllables = (await getValue<Syllable[]>(`${take.id}:score`)) ?? guessAlignment(s.lyrics, vocalMelody(s))
    setVocalWork({ text: 'Singing…', takeId: take.id })
    try {
      await singTake(voice, syllables, take)
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      setVocalWork({ text: '' })
    }
  }

  const cancelVocals = () => {
    vocalJob.current++
    void api.cancelCompose()
    setVocalWork({ text: '' })
  }

  // "Write a melody and sing it": once the composer has added the Vocal track, sing it.
  useEffect(() => {
    if (!pendingSing.current || busy) return
    const voice = pendingSing.current
    pendingSing.current = null
    if (vocalMelody(song).length) void generateVocals(voice)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, song])

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
        <button className={showVocals ? 'on' : ''} onClick={() => setShowVocals((v) => !v)} title="Record or generate vocals">🎤 Vocals</button>
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
            onOpenVocals={() => {
              setTab('arrange')
              setShowVocals(true)
            }}
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
        {showVocals && (
          <VocalPanel
            song={song}
            engine={engine.current}
            working={vocalWork.takeId ? '' : vocalWork.text}
            canCompose={settings.hasApiKey}
            composing={busy}
            onStarted={() => setPlaying(true)}
            onTake={onTake}
            onGenerate={generateVocals}
            onWriteMelody={writeMelodyAndSing}
            onWriteLyrics={() => setTab('lyrics')}
            onCancel={cancelVocals}
            onClose={() => setShowVocals(false)}
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
                  onAudition={(id) => void engine.current?.audition(id)}
                />
              ))}
              {song.vocals.map((v) => (
                <VocalRow
                  key={v.id}
                  take={v}
                  audio={vocalAudio[v.id]}
                  bars={song.bars}
                  bpm={song.bpm}
                  playStep={playStep}
                  selected={selected === v.id}
                  soloed={solo === v.id}
                  hasMelody={vocalMelody(song).length > 0}
                  busy={vocalWork.takeId === v.id}
                  onSelect={() => setSelected(selected === v.id ? null : v.id)}
                  onUpdate={(patch, record) => updateTake(v.id, patch, record)}
                  onTune={(tune) => retune(v, tune)}
                  onRevoice={(voice) => revoice(v, voice)}
                  onDelete={() => deleteTake(v.id)}
                  onSolo={() => setSolo(solo === v.id ? null : v.id)}
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

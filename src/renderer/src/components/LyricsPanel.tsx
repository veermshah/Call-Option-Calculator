import { useEffect, useState } from 'react'
import type { Song } from '@shared/song'
import { sectionsToText, userLines, type LyricSection } from '@shared/lyrics'
import { api } from '../lib/api'

interface Props {
  song: Song
  canCompose: boolean
  composing: boolean
  onType: (lyrics: string) => void
  onAccept: (lyrics: string) => void
  onSingIt: () => void
  onOpenSettings: () => void
}

const ACTIONS = [
  { label: 'Finish this verse', prompt: 'Finish the section I am in the middle of (usually the last one). Only that section.' },
  { label: 'Write a chorus', prompt: 'Write a chorus that captures the central idea of what I have so far. Make it short and catchy, with a hook line that repeats.' },
  { label: 'Next section', prompt: 'Write the next section that should come after what I have (e.g. a second verse, pre-chorus or bridge — your call).' },
  { label: 'Complete the song', prompt: 'Complete the whole song around my lines: verses, pre-chorus if it fits, chorus (repeated where it returns), a bridge and an ending.' }
]

const PLACEHOLDER = `[Verse 1]
Streetlights hum a song I almost know
Your jacket still hangs by the door

Write a few lines, then ask for the rest →`

interface Draft {
  sections: LyricSection[]
  message: string
  missing: string[]
  instruction: string
}

export function LyricsPanel({ song, canCompose, composing, onType, onAccept, onSingIt, onOpenSettings }: Props) {
  const [keepMine, setKeepMine] = useState(true)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => api.onComposeProgress((n) => busy && setProgress(n)), [busy])

  const run = async (instruction: string) => {
    if (busy || !instruction.trim()) return
    setBusy(true)
    setProgress(0)
    setError('')
    const res = await api.writeLyrics({ lyrics: song.lyrics, instruction, keepMine, song })
    setBusy(false)
    if (res.ok) setDraft({ sections: res.sections, message: res.message, missing: res.missing, instruction })
    else setError(res.error)
  }

  const hasLines = userLines(song.lyrics).length > 0
  const newCount = draft?.sections.reduce((n, s) => n + s.lines.filter((l) => !l.mine).length, 0) ?? 0

  return (
    <div className="lyrics">
      <section className="lyrics-edit">
        <div className="lyrics-head">
          <h2>Your lyrics</h2>
          <label className="check" title="When on, Claude must return your lines word for word">
            <input type="checkbox" checked={keepMine} onChange={(e) => setKeepMine(e.target.checked)} />
            Keep my lines exactly
          </label>
        </div>
        <textarea
          className="lyrics-text"
          value={song.lyrics}
          placeholder={PLACEHOLDER}
          spellCheck
          onChange={(e) => onType(e.target.value)}
        />
        {!canCompose ? (
          <div className="lyrics-key">
            Add your Anthropic API key to get help with lyrics. <button className="primary" onClick={onOpenSettings}>Open settings</button>
          </div>
        ) : (
          <>
            <div className="chips">
              {ACTIONS.map((a) => (
                <button key={a.label} className="chip" disabled={busy} onClick={() => run(a.prompt)}>
                  {a.label}
                </button>
              ))}
            </div>
            <form
              className="lyrics-ask"
              onSubmit={(e) => {
                e.preventDefault()
                run(custom)
              }}
            >
              <input
                value={custom}
                placeholder="Or ask for something specific: “a darker second verse about leaving”"
                onChange={(e) => setCustom(e.target.value)}
              />
              <button className="primary" type="submit" disabled={busy || !custom.trim()}>Write</button>
            </form>
          </>
        )}
      </section>

      <section className="lyrics-draft">
        {busy ? (
          <div className="draft-empty">
            <span className="spinner" /> Writing{progress > 0 ? ` · ${(progress / 1000).toFixed(1)}k chars` : '…'}
            <button className="link" onClick={() => api.cancelCompose()}>Cancel</button>
          </div>
        ) : error ? (
          <div className="draft-empty error-text">{error}</div>
        ) : draft ? (
          <>
            <div className="lyrics-head">
              <h2>Claude’s draft</h2>
              <span className="muted">{newCount} new line{newCount === 1 ? '' : 's'}</span>
            </div>
            <p className="draft-msg">{draft.message}</p>
            {draft.missing.length > 0 && (
              <p className="draft-warn">
                Heads up: {draft.missing.length} of your lines didn’t come back unchanged ({draft.missing.map((l) => `“${l}”`).join(', ')}).
                Try again, or accept and fix them by hand.
              </p>
            )}
            <div className="draft-body">
              {draft.sections.map((s, i) => (
                <div key={i} className="draft-section">
                  <div className="draft-label">[{s.label}]</div>
                  {s.lines.map((l, j) => (
                    <div key={j} className={`draft-line${l.mine ? ' mine' : ' new'}`}>{l.text}</div>
                  ))}
                </div>
              ))}
            </div>
            <div className="draft-actions">
              <span className="legend"><span className="sw new" /> Claude <span className="sw mine" /> You</span>
              <span className="spacer" />
              <button onClick={() => setDraft(null)}>Discard</button>
              <button onClick={() => run(draft.instruction)}>Try again</button>
              <button
                className="primary"
                onClick={() => {
                  onAccept(sectionsToText(draft.sections))
                  setDraft(null)
                }}
              >
                Use these lyrics
              </button>
            </div>
          </>
        ) : (
          <div className="draft-empty">
            <p>Write a line or a whole verse on the left, then pick what you want next. Claude matches your voice, rhyme scheme and syllable counts, and keeps your lines as they are.</p>
            <p className="muted">Lyrics are saved with the project, and the composer reads them for mood.</p>
            <button disabled={!hasLines || !canCompose || composing} onClick={onSingIt} title="Adds a Vocal track with a melody for your lyrics">
              🎤 Write a vocal melody for these lyrics
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

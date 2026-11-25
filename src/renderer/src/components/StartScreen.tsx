import { useState } from 'react'

interface Props {
  busy: boolean
  progress: number
  error?: string | null
  onCreate: (prompt: string) => void
  onCancel: () => void
  onPlayKeys: () => void
  onDemo: () => void
  onBlank: () => void
  onOpen: () => void
}

// One tap fills the prompt with a full description you can still edit.
const STYLES = [
  { label: 'Lo-fi', prompt: 'A dusty lo-fi hip hop beat at 84 bpm with jazzy keys and a lazy swing' },
  { label: 'House', prompt: 'A bouncy house groove at 124 bpm with offbeat hats and a piano stab' },
  { label: 'Synthwave', prompt: 'Dreamy synthwave at 100 bpm, big pads, a pulsing bass and an arpeggio' },
  { label: 'Trap', prompt: 'A dark trap beat at 140 bpm with rolling hi-hats, 808 bass and a bell melody' },
  { label: 'Techno', prompt: 'A driving techno loop at 128 bpm with a rolling bassline and a hypnotic lead' },
  { label: 'Chill', prompt: 'A warm, chill ambient loop at 80 bpm with soft pads and a gentle pluck melody' }
]

export function StartScreen({ busy, progress, error, onCreate, onCancel, onPlayKeys, onDemo, onBlank, onOpen }: Props) {
  const [text, setText] = useState('')

  const create = () => {
    const p = text.trim()
    if (p && !busy) onCreate(p)
  }

  if (busy) {
    return (
      <div className="start">
        <div className="start-busy">
          <span className="spinner big" />
          <h1>Writing your song…</h1>
          <p>Claude is composing every part. It starts playing as soon as it's ready{progress > 0 ? ` (${(progress / 1000).toFixed(1)}k chars so far)` : ''}.</p>
          <button className="link" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="start">
      <h1>What do you want to make?</h1>
      <p className="start-sub">Describe a vibe and Claude writes the whole loop. You can change anything after.</p>
      <form
        className="start-prompt"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <textarea
          autoFocus
          rows={3}
          value={text}
          placeholder="e.g. a sleepy rainy-day beat with soft piano and brushed drums"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              create()
            }
          }}
        />
        <div className="start-row">
          <div className="styles">
            {STYLES.map((s) => (
              <button
                key={s.label}
                type="button"
                className={`chip${text === s.prompt ? ' on' : ''}`}
                onClick={() => setText(s.prompt)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button className="primary create" type="submit" disabled={!text.trim()}>
            ✦ Create song
          </button>
        </div>
      </form>

      {error && <p className="start-error">{error}</p>}

      <div className="or"><span>or</span></div>

      <div className="start-paths">
        <button className="path" onClick={onPlayKeys}>
          <span className="path-icon">🎹</span>
          <strong>Play it yourself</strong>
          <span>Jam chords on your keyboard, then let Claude add the band.</span>
        </button>
        <button className="path" onClick={onDemo}>
          <span className="path-icon">▶</span>
          <strong>Hear a demo</strong>
          <span>Open a finished loop and remix it.</span>
        </button>
        <button className="path" onClick={onBlank}>
          <span className="path-icon">✎</span>
          <strong>Start blank</strong>
          <span>Click notes into an empty track by hand.</span>
        </button>
      </div>
      <button className="link start-open" onClick={onOpen}>Open a saved project file</button>
    </div>
  )
}

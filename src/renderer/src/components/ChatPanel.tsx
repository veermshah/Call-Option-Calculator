import { useEffect, useRef, useState } from 'react'
import type { ChatTurn } from '@shared/ipc'

interface Props {
  turns: (ChatTurn & { error?: boolean })[]
  busy: boolean
  progress: number
  hasApiKey: boolean
  hasSong: boolean
  onSend: (prompt: string) => void
  onCancel: () => void
  onOpenSettings: () => void
}

const STARTERS = [
  'A dusty lo-fi hip hop beat at 84 bpm with jazzy keys',
  'Driving techno loop, 128 bpm, rolling bassline',
  'Dreamy synthwave, 4 bars, big pads and an arpeggio',
  'Bouncy house groove with offbeat hats and a piano stab'
]

const TWEAKS = [
  'Make the drums busier',
  'Add a counter-melody',
  'Make it darker',
  'Double the length with a variation'
]

export function ChatPanel({ turns, busy, progress, hasApiKey, hasSong, onSend, onCancel, onOpenSettings }: Props) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  const send = (p: string) => {
    const prompt = p.trim()
    if (!prompt || busy) return
    onSend(prompt)
    setText('')
  }

  const suggestions = hasSong ? TWEAKS : STARTERS

  return (
    <aside className="chat">
      <div className="chat-head">
        <span className="dot" /> Composer
      </div>
      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p>Describe a vibe and Claude writes the loop. Then keep talking to reshape it, or edit notes by hand.</p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}${t.error ? ' error' : ''}`}>
            {t.text}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant pending">
            <span className="spinner" /> Composing{progress > 0 ? ` · ${(progress / 1000).toFixed(1)}k chars` : '…'}
            <button className="link" onClick={onCancel}>Cancel</button>
          </div>
        )}
        <div ref={end} />
      </div>

      {!hasApiKey ? (
        <div className="chat-key">
          <p>Add your Anthropic API key to start composing.</p>
          <button className="primary" onClick={onOpenSettings}>Open settings</button>
        </div>
      ) : (
        <>
          <div className="chips">
            {suggestions.map((s) => (
              <button key={s} className="chip" disabled={busy} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault()
              send(text)
            }}
          >
            <textarea
              value={text}
              placeholder={hasSong ? 'Tell Claude what to change…' : 'Describe the music you want…'}
              rows={3}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(text)
                }
              }}
            />
            <button className="primary" type="submit" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </aside>
  )
}

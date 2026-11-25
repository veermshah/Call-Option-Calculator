import { useEffect, useRef, useState } from 'react'
import type { ChatTurn } from '@shared/ipc'

interface Props {
  turns: (ChatTurn & { error?: boolean })[]
  busy: boolean
  progress: number
  hasSong: boolean
  onSend: (prompt: string) => void
  onCancel: () => void
}

const TWEAKS = [
  'Make the drums busier',
  'Add a counter-melody',
  'Make it darker',
  'Double the length with a variation'
]

export function ChatPanel({ turns, busy, progress, hasSong, onSend, onCancel }: Props) {
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

  // Before there's a song, the big prompt in the middle is the one place to start.
  const showInput = hasSong || turns.length > 0

  return (
    <aside className="chat">
      <div className="chat-head">
        <span className="dot" /> Composer
      </div>
      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-empty">
            {hasSong ? (
              <p>Tell Claude what to change, or tap an idea below. You can also edit notes by hand on the right.</p>
            ) : (
              <p>Start your song in the middle. Then keep talking here to reshape it: “busier drums”, “add a counter-melody”, “make it darker”.</p>
            )}
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

      {showInput && (
        <>
          <div className="chips">
            {TWEAKS.map((s) => (
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
              placeholder="Tell Claude what to change…"
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

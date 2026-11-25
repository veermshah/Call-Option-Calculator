import type { Song } from '@shared/song'
import { Popover } from './Popover'

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].flatMap((n) => [`${n} major`, `${n} minor`])

interface Props {
  song: Song
  onChange: (patch: Partial<Song>, record?: boolean) => void
}

/** The tempo / key / length readout (like GarageBand's LCD); click to change. */
export function SongSettings({ song, onChange }: Props) {
  return (
    <Popover
      className="lcd"
      title="Tempo, key, length and swing"
      label={
        <>
          <b>{song.bpm}</b> BPM <i>·</i> <b>{song.key}</b> <i>·</i> <b>{song.bars}</b> {song.bars === 1 ? 'bar' : 'bars'} ▾
        </>
      }
    >
      {() => (
        <div className="song-settings">
          <div className="ss-field">
            <span className="ss-label">Tempo</span>
            <div className="stepper">
              <button onClick={() => onChange({ bpm: song.bpm - 5 })} title="5 BPM slower">−</button>
              <input type="number" min={40} max={220} value={song.bpm} onChange={(e) => onChange({ bpm: +e.target.value })} />
              <button onClick={() => onChange({ bpm: song.bpm + 5 })} title="5 BPM faster">+</button>
              <span>BPM</span>
            </div>
          </div>
          <div className="ss-field">
            <span className="ss-label">Key</span>
            <select value={KEYS.includes(song.key) ? song.key : ''} onChange={(e) => onChange({ key: e.target.value })}>
              {!KEYS.includes(song.key) && <option value="">{song.key}</option>}
              {KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="ss-field">
            <span className="ss-label">Length</span>
            <div className="seg">
              {[1, 2, 4, 8, 16].map((b) => (
                <button key={b} className={song.bars === b ? 'on' : ''} onClick={() => onChange({ bars: b })}>
                  {b}
                </button>
              ))}
            </div>
            <small>bars in the loop</small>
          </div>
          <div className="ss-field">
            <span className="ss-label">Swing <em>{Math.round(song.swing * 200)}%</em></span>
            <input type="range" min={0} max={0.5} step={0.01} value={song.swing} onChange={(e) => onChange({ swing: +e.target.value }, false)} />
          </div>
        </div>
      )}
    </Popover>
  )
}

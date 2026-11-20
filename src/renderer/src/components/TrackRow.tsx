import { INSTRUMENTS, type Instrument, type Note, type Track } from '@shared/song'
import { colorFor } from '../lib/colors'
import { PianoRoll } from './PianoRoll'

interface Props {
  track: Track
  bars: number
  playStep: number
  selected: boolean
  soloed: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<Track>, record?: boolean) => void
  onDelete: () => void
  onSolo: () => void
  onPreview: (note: Note) => void
}

export function TrackRow({ track, bars, playStep, selected, soloed, onSelect, onUpdate, onDelete, onSolo, onPreview }: Props) {
  return (
    <div className={`track${selected ? ' selected' : ''}${track.muted ? ' muted' : ''}`}>
      <div className="track-head" onClick={onSelect}>
        <span className="swatch" style={{ background: colorFor(track.instrument) }} />
        <input
          className="track-name"
          value={track.name}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate({ name: e.target.value }, false)}
        />
        <select
          value={track.instrument}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate({ instrument: e.target.value as Instrument, notes: e.target.value === 'drums' || track.instrument === 'drums' ? [] : track.notes })}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <div className="track-buttons" onClick={(e) => e.stopPropagation()}>
          <button className={`toggle${track.muted ? ' on' : ''}`} title="Mute" onClick={() => onUpdate({ muted: !track.muted })}>M</button>
          <button className={`toggle solo${soloed ? ' on' : ''}`} title="Solo" onClick={onSolo}>S</button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={track.volume}
            title={`Volume ${Math.round(track.volume * 100)}%`}
            onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) }, false)}
          />
          <button className="icon" title="Delete track" onClick={onDelete}>✕</button>
        </div>
      </div>
      {selected ? (
        <PianoRoll
          track={track}
          bars={bars}
          playStep={playStep}
          onChange={(notes) => onUpdate({ notes })}
          onPreview={onPreview}
        />
      ) : (
        <div onClick={onSelect}>
          <PianoRoll track={track} bars={bars} playStep={playStep} compact />
        </div>
      )}
    </div>
  )
}

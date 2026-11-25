import type { Instrument, Note, Track } from '@shared/song'
import { instrumentGroups, isDrumKit } from '@shared/instruments'
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
  /** Play a short phrase on an instrument so it can be heard. */
  onAudition?: (instrument: Instrument) => void
}

const GROUPS = instrumentGroups()

export function TrackRow({ track, bars, playStep, selected, soloed, onSelect, onUpdate, onDelete, onSolo, onPreview, onAudition }: Props) {
  const pick = (instrument: Instrument) => {
    // Drum hits and pitched notes don't translate, so switching between them starts the part empty.
    const keep = isDrumKit(instrument) === isDrumKit(track.instrument)
    onUpdate({ instrument, notes: keep ? track.notes : [] })
    onAudition?.(instrument)
  }

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
          className="instrument-picker"
          value={track.instrument}
          title="Instrument"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => pick(e.target.value as Instrument)}
        >
          {GROUPS.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.items.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {onAudition && (
          <button
            className="icon audition"
            title="Hear this instrument"
            onClick={(e) => {
              e.stopPropagation()
              onAudition(track.instrument)
            }}
          >
            ▶
          </button>
        )}
        <div className="track-buttons" onClick={(e) => e.stopPropagation()}>
          <button
            className={`toggle lock${track.locked ? ' on' : ''}`}
            title={track.locked ? 'Locked: Claude keeps this part exactly as is' : 'Lock so Claude never changes this part'}
            onClick={() => onUpdate({ locked: !track.locked })}
          >
            {track.locked ? '🔒' : '🔓'}
          </button>
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

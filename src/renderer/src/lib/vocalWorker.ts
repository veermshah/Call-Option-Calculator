// Heavy vocal processing off the main thread so playback never stutters.
import { autotune, type TuneContext } from '@shared/vocals/tune'
import { renderSinging, VOICE_PRESETS, type SungNote } from '@shared/vocals/sing'
import type { TuneSettings, VoiceId } from '@shared/song'

export type VocalJob =
  | { id: number; type: 'autotune'; samples: Float32Array; ctx: TuneContext; tune: TuneSettings }
  | { id: number; type: 'sing'; notes: SungNote[]; sampleRate: number; voice: VoiceId }

self.onmessage = (e: MessageEvent<VocalJob>) => {
  const job = e.data
  try {
    const out = job.type === 'autotune' ? autotune(job.samples, job.ctx, job.tune) : renderSinging(job.notes, job.sampleRate, VOICE_PRESETS[job.voice])
    // A take left untouched comes back as the same array; copy so both sides keep theirs.
    const data = out === (job as { samples?: Float32Array }).samples ? new Float32Array(out) : out
    ;(self as unknown as Worker).postMessage({ id: job.id, ok: true, data }, [data.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

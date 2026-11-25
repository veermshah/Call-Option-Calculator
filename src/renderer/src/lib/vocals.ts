import type { TuneContext } from '@shared/vocals/tune'
import type { SungNote } from '@shared/vocals/sing'
import type { TuneSettings, VoiceId } from '@shared/song'

// Runs vocal jobs in a worker, or on the main thread if workers are unavailable.

type Pending = { resolve: (d: Float32Array) => void; reject: (e: Error) => void }
let worker: Worker | null | undefined
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./vocalWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; data?: Float32Array; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok && e.data.data) p.resolve(e.data.data)
      else p.reject(new Error(e.data.error ?? 'Vocal processing failed'))
    }
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Vocal processing failed'))
      pending.clear()
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

function post(job: Record<string, unknown>, transfer: Transferable[] = []): Promise<Float32Array> | null {
  const w = getWorker()
  if (!w) return null
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ ...job, id }, transfer)
  })
}

export async function autotuneTake(samples: Float32Array, ctx: TuneContext, tune: TuneSettings): Promise<Float32Array> {
  const copy = new Float32Array(samples)
  const viaWorker = post({ type: 'autotune', samples: copy, ctx, tune }, [copy.buffer])
  if (viaWorker) return viaWorker
  const { autotune } = await import('@shared/vocals/tune')
  return new Float32Array(autotune(samples, ctx, tune))
}

export async function singScore(notes: SungNote[], sampleRate: number, voice: VoiceId): Promise<Float32Array> {
  const viaWorker = post({ type: 'sing', notes, sampleRate, voice })
  if (viaWorker) return viaWorker
  const { renderSinging, VOICE_PRESETS } = await import('@shared/vocals/sing')
  return renderSinging(notes, sampleRate, VOICE_PRESETS[voice])
}

import Anthropic from '@anthropic-ai/sdk'
import { DRUM_SOUNDS, INSTRUMENTS, STEPS_PER_BAR, normalizeSong, type Song } from '@shared/song'
import type { ComposeRequest, ComposeResult } from '@shared/ipc'

export const DEFAULT_MODEL = 'claude-opus-5-5'

// JSON schema for structured output. Numeric ranges live in descriptions
// because they're enforced afterwards by normalizeSong().
const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pitch', 'start', 'length', 'velocity'],
  properties: {
    pitch: {
      type: 'string',
      description: `Pitch like "C4", "F#2", "Bb3". On drum tracks use one of: ${DRUM_SOUNDS.join(', ')}.`
    },
    start: { type: 'integer', description: '16th-note step from the start of the loop (0-based).' },
    length: { type: 'integer', description: 'Duration in 16th-note steps (>= 1).' },
    velocity: { type: 'number', description: 'Loudness 0.05 to 1.' }
  }
} as const

export const SONG_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'song'],
  properties: {
    message: {
      type: 'string',
      description: 'One to three sentences to the musician about what you made or changed.'
    },
    song: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'bpm', 'key', 'bars', 'swing', 'tracks'],
      properties: {
        title: { type: 'string' },
        bpm: { type: 'integer', description: '40 to 220.' },
        key: { type: 'string', description: 'e.g. "A minor", "F# dorian".' },
        bars: { type: 'integer', description: `Loop length in bars, 1 to 16. One bar = ${STEPS_PER_BAR} steps.` },
        swing: { type: 'number', description: '0 (straight) to 0.5 (heavy swing).' },
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'instrument', 'volume', 'notes'],
            properties: {
              name: { type: 'string' },
              instrument: { type: 'string', enum: [...INSTRUMENTS] },
              volume: { type: 'number', description: '0 to 1.' },
              notes: { type: 'array', items: NOTE_SCHEMA }
            }
          }
        }
      }
    }
  }
} as const

const SYSTEM_PROMPT = `You are the composer inside Riff, a desktop loop studio. A musician describes what they want and you write or revise a looping multi-track pattern.

How the studio works:
- Time is in 16th-note steps; one bar is ${STEPS_PER_BAR} steps. A loop of N bars has steps 0 to N*${STEPS_PER_BAR}-1, and notes must end inside the loop.
- Instruments: ${INSTRUMENTS.join(', ')}. "drums" tracks use the sound names ${DRUM_SOUNDS.join(', ')} as pitches; every other instrument uses pitches like "C3".
- Sensible ranges: bass C1-C3, keys and pads C3-C5, lead and pluck C4-C6.
- Each track is one instrument. Use a handful of tracks (typically 3-6), each with a clear role.

When the musician asks for a change, start from the current song you're given and change only what they asked for, keeping track names stable so their mix settings survive. When they ask for something new, write it from scratch.

Write music that sounds intentional: stay in key, give basslines and melodies shape and repetition with variation, vary velocity for groove, and leave space. Return the complete song every time, every note included.`

function userContent(req: ComposeRequest): string {
  const current = req.song.tracks.length
    ? JSON.stringify({ ...req.song, tracks: req.song.tracks.map(({ id: _id, muted: _m, ...t }) => t) })
    : '(empty — nothing composed yet)'
  return `Current song:\n${current}\n\nRequest: ${req.prompt}`
}

/** Parse Claude's text output into a validated song, keeping ids and mute state of tracks that survive. */
export function parseComposeOutput(text: string, previous: Song): ComposeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Claude returned something that is not valid JSON. Try again.' }
  }
  const obj = parsed as { message?: unknown; song?: unknown }
  if (!obj || typeof obj !== 'object' || !obj.song) {
    return { ok: false, error: 'Claude did not return a song. Try again.' }
  }
  const song = normalizeSong(obj.song)
  const byName = new Map(previous.tracks.map((t) => [t.name.toLowerCase(), t]))
  for (const t of song.tracks) {
    const prev = byName.get(t.name.toLowerCase())
    if (prev) {
      t.id = prev.id
      t.muted = prev.muted
    }
  }
  const message = typeof obj.message === 'string' && obj.message ? obj.message : 'Done.'
  return { ok: true, song, message }
}

export async function compose(
  apiKey: string,
  model: string,
  req: ComposeRequest,
  onProgress: (chars: number) => void,
  signal?: AbortSignal
): Promise<ComposeResult> {
  const client = new Anthropic({ apiKey })

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...req.history.slice(-8).map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: userContent(req) }
  ]
  // The API needs the conversation to start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift()

  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        system: SYSTEM_PROMPT,
        messages,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: SONG_RESPONSE_SCHEMA as unknown as Record<string, unknown> }
        },
        // On a safety decline, let the API re-run on a fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      },
      { signal }
    )

    let chars = 0
    stream.on('text', (delta) => {
      chars += delta.length
      onProgress(chars)
    })

    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined this request. Try rephrasing it.' }
    }
    if (final.stop_reason === 'max_tokens') {
      return { ok: false, error: 'The song was too long to finish. Ask for fewer bars or tracks.' }
    }
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return parseComposeOutput(text, req.song)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'Your API key was rejected. Check it in Settings.' }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Rate limited by the API. Wait a moment and try again.' }
    }
    if (err instanceof Anthropic.APIUserAbortError) {
      return { ok: false, error: 'Cancelled.' }
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `API error ${err.status ?? ''}: ${err.message}` }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

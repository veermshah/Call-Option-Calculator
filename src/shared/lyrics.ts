import { callStructured } from './claude'
import type { Song } from './song'

export interface LyricLine {
  text: string
  /** True when the line is the musician's own, unchanged. */
  mine: boolean
}

export interface LyricSection {
  label: string
  lines: LyricLine[]
}

export interface LyricsRequest {
  /** What the musician has written so far (may include [Section] headers). */
  lyrics: string
  /** What they want: "finish this verse", "write a chorus", … */
  instruction: string
  /** When true, their lines must come back word for word. */
  keepMine: boolean
  song: Song
}

export type LyricsResult =
  | { ok: true; sections: LyricSection[]; message: string; missing: string[] }
  | { ok: false; error: string }

const HEADER = /^\s*\[(.+?)\]\s*$/

/** The musician's own lyric lines, without section headers or blank lines. */
export function userLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !HEADER.test(l))
}

/** Text form used in the editor: "[Verse 1]" headers, blank line between sections. */
export function sectionsToText(sections: LyricSection[]): string {
  return sections
    .map((s) => [`[${s.label}]`, ...s.lines.map((l) => l.text)].join('\n'))
    .join('\n\n')
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Trust but verify: a line only counts as "mine" if it really matches one of
 * the musician's lines, and we report any of their lines that went missing.
 */
export function checkLyrics(sections: LyricSection[], original: string): { sections: LyricSection[]; missing: string[] } {
  const mine = userLines(original)
  // normalised text -> the writer's original spellings still unclaimed
  const pool = new Map<string, string[]>()
  for (const l of mine) pool.set(norm(l), [...(pool.get(norm(l)) ?? []), l])
  const fixed = sections.map((s) => ({
    label: s.label.trim() || 'Section',
    lines: s.lines
      .filter((l) => typeof l.text === 'string' && l.text.trim())
      .map((l) => {
        const left = pool.get(norm(l.text))
        // Matched one of theirs: use their exact spelling, not the model's copy.
        if (left?.length) return { text: left.shift()!, mine: true }
        return { text: l.text.trim(), mine: false }
      })
  }))
  const missing = [...pool.values()].flat()
  return { sections: fixed.filter((s) => s.lines.length), missing }
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'sections'],
  properties: {
    message: { type: 'string', description: 'One or two sentences to the songwriter about what you wrote and why.' },
    sections: {
      type: 'array',
      description: 'The complete lyrics, in order, including every line the songwriter already wrote.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'lines'],
        properties: {
          label: { type: 'string', description: 'e.g. "Verse 1", "Pre-Chorus", "Chorus", "Bridge", "Outro".' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'mine'],
              properties: {
                text: { type: 'string' },
                mine: { type: 'boolean', description: "True only for the songwriter's own line, copied exactly." }
              }
            }
          }
        }
      }
    }
  }
} as const

const SYSTEM = `You are a co-writer helping a songwriter finish lyrics inside Riff, a music studio. They give you what they've written and what they want next.

Write like a good collaborator, not a greeting card:
- Match their voice: point of view, tense, vocabulary, tone and imagery. Extend their images and ideas instead of starting new ones.
- Match their craft: follow the rhyme scheme they set up (or a natural one if none), keep line lengths and syllable counts close to theirs so the lines sing to the same melody, and keep stresses landing in similar places.
- Choruses should be short, repeatable and hold the song's central idea or hook; verses carry the story and specific detail; a bridge turns or reframes.
- Prefer concrete, specific images over clichés and abstractions. Let it be singable: open vowels on long notes, no tongue-twisters.
- Do only what was asked. "Finish this verse" means complete the current section, not write the whole song.

Return the complete lyrics as sections, including every one of their existing lines.`

function songContext(song: Song): string {
  const parts = song.tracks.map((t) => `${t.name} (${t.instrument})`).join(', ')
  return `Song: "${song.title}", ${song.bpm} bpm, ${song.key}${parts ? `, instruments: ${parts}` : ''}.`
}

export async function writeLyrics(
  apiKey: string,
  model: string,
  req: LyricsRequest,
  onProgress: (chars: number) => void,
  signal?: AbortSignal,
  opts: { browser?: boolean } = {}
): Promise<LyricsResult> {
  const keepRule = req.keepMine
    ? 'Keep every one of my lines exactly as written, in the same order, and mark them mine: true. Write new lines around them.'
    : 'You may revise my lines to improve them. Mark a line mine: true only if you left it exactly as I wrote it.'
  const content = `${songContext(req.song)}

My lyrics so far:
${req.lyrics.trim() || '(nothing yet)'}

What I want: ${req.instruction}

${keepRule}`

  const res = await callStructured({
    apiKey,
    model,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    schema: SCHEMA as unknown as Record<string, unknown>,
    effort: 'medium',
    onProgress,
    signal,
    browser: opts.browser,
    tooLongMessage: 'The lyrics were too long to finish. Ask for one section at a time.'
  })
  if (!res.ok) return res

  let parsed: { message?: unknown; sections?: unknown }
  try {
    parsed = JSON.parse(res.text)
  } catch {
    return { ok: false, error: 'Claude returned something that is not valid JSON. Try again.' }
  }
  if (!Array.isArray(parsed.sections)) return { ok: false, error: 'Claude did not return any lyrics. Try again.' }
  const raw = (parsed.sections as unknown[]).map((s) => {
    const r = (s ?? {}) as { label?: unknown; lines?: unknown }
    return {
      label: typeof r.label === 'string' ? r.label : 'Section',
      lines: Array.isArray(r.lines)
        ? (r.lines as unknown[]).map((l) => {
            const x = (l ?? {}) as { text?: unknown }
            return { text: typeof x.text === 'string' ? x.text : '', mine: false }
          })
        : []
    }
  })
  const checked = checkLyrics(raw, req.lyrics)
  return {
    ok: true,
    sections: checked.sections,
    missing: req.keepMine ? checked.missing : [],
    message: typeof parsed.message === 'string' && parsed.message ? parsed.message : 'Here you go.'
  }
}

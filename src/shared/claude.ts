import Anthropic from '@anthropic-ai/sdk'

export type StructuredResult = { ok: true; text: string } | { ok: false; error: string }

export interface StructuredCall {
  apiKey: string
  model: string
  system: string
  messages: Anthropic.Beta.BetaMessageParam[]
  schema: Record<string, unknown>
  effort?: 'low' | 'medium' | 'high'
  onProgress?: (chars: number) => void
  signal?: AbortSignal
  /** Web build: the visitor's own key goes straight from their browser to api.anthropic.com. */
  browser?: boolean
  tooLongMessage?: string
}

/** One streamed request whose answer is JSON matching `schema`. Errors come back as friendly messages. */
export async function callStructured(c: StructuredCall): Promise<StructuredResult> {
  const client = new Anthropic({ apiKey: c.apiKey, dangerouslyAllowBrowser: c.browser === true })
  const messages = [...c.messages]
  // The API needs the conversation to start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift()

  try {
    const stream = client.beta.messages.stream(
      {
        model: c.model,
        max_tokens: 64000,
        system: c.system,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: c.effort ?? 'medium', format: { type: 'json_schema', schema: c.schema } },
        // On a safety decline, let the API re-run on a fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      },
      { signal: c.signal }
    )

    let chars = 0
    stream.on('text', (delta) => {
      chars += delta.length
      c.onProgress?.(chars)
    })

    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined this request. Try rephrasing it.' }
    }
    if (final.stop_reason === 'max_tokens') {
      return { ok: false, error: c.tooLongMessage ?? 'The answer was too long to finish.' }
    }
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return { ok: true, text }
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

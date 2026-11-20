# Riff

A desktop studio for making music with Claude. Describe a vibe ("dusty lo-fi beat at 84 bpm with jazzy keys") and Claude writes a multi-track loop. Then keep talking to reshape it ("make the drums busier", "add a counter-melody"), or edit notes by hand in the piano roll.

Built with Electron, React, TypeScript, Tone.js and the Anthropic SDK.

## Run it

```bash
npm install
npm run dev        # hot-reloading dev app
npm run build && npm start   # production build
npm test           # unit tests
npm run typecheck
```

Open **Settings** (⚙) and paste an Anthropic API key. It's stored encrypted with your OS keychain (`safeStorage`). The `ANTHROPIC_API_KEY` environment variable also works.

## How it works

```
renderer (React)                     main process
───────────────                      ────────────
chat prompt + current song  ──IPC──▶ composer.ts ──▶ Claude (structured JSON output)
           ▲                                │
           └──────── validated Song ◀───────┘  normalizeSong() clamps & cleans
Tone.js engine plays the Song; piano roll edits it; undo/redo over every change
```

- **Song model** (`src/shared/song.ts`): tracks of notes on a 16th-note grid. Instruments: drums, bass, lead, pad, pluck, keys. Drum notes use sound names (`kick`, `snare`, `hat`…).
- **Composer** (`src/main/composer.ts`): sends the current song plus recent chat to Claude with a JSON schema for the response, so edits build on what's there. The API key never reaches the renderer.
- **Engine** (`src/renderer/src/lib/engine.ts`): synthesized voices per instrument, swing, mute/solo, live edits while playing.
- **Export**: Save/Open `.riff.json` projects and export a 4× looped Standard MIDI File to drop into any DAW.

Try `examples/late-night-tape.riff.json` via **Open** without an API key.

## Shortcuts

- `Space`: play / stop
- `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`: undo / redo
- Piano roll: click to add a note (drag to set its length), click a note to delete it

## Ideas for next steps

- Sample-based drum kits and instrument presets
- Audio export (WAV) via offline rendering
- Song sections (intro / verse / drop) and an arrangement timeline
- Per-track "regenerate just this part" and variations
- MIDI input / output to drive hardware and DAWs

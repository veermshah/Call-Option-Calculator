# Riff

A desktop studio for making music with Claude. Describe a vibe ("dusty lo-fi beat at 84 bpm with jazzy keys") and Claude writes a multi-track loop. Then keep talking to reshape it ("make the drums busier", "add a counter-melody"), or edit notes by hand in the piano roll.

The first screen gives you four ways in: type a vibe (or tap a style) and hit **Create song**, **Play it yourself** on your keyboard, **Hear a demo** you can remix, or **Start blank**. Riff asks for your API key only the first time Claude is needed, then carries on with what you asked. Your song autosaves in the browser, and **Export** downloads it as audio (WAV), MIDI or a project file.

Or skip the typing: press **🎹 Keys** (or `` ` ``), play a few chords on your laptop's home row, and hit **Build the band around this**. Claude writes drums, bass and more to fit what you played, and never touches your part.

Built with Electron, React, TypeScript, Tone.js and the Anthropic SDK. Runs as a desktop app or in the browser: **https://riff-studio-one.vercel.app** (bring your own Anthropic API key).

## Run it

```bash
npm install
npm run dev        # hot-reloading dev app
npm run build && npm start   # production build
npm run dev:web    # browser version
npm test           # unit tests
npm run typecheck
```

Open **Settings** (⚙) and paste an Anthropic API key. On desktop it's stored encrypted with your OS keychain (`safeStorage`), and the `ANTHROPIC_API_KEY` environment variable also works. In the browser it's kept in that browser's localStorage and requests go straight to `api.anthropic.com`; the site has no server and never sees the key.

## Write lyrics with Claude

Open the **Lyrics** tab, write a line or a verse, then choose **Finish this verse**, **Write a chorus**, **Next section** or **Complete the song** (or ask for something specific). Claude matches your voice, rhyme scheme and syllable counts. Its draft shows up next to yours with the new lines highlighted, and nothing changes until you click **Use these lyrics**.

With **Keep my lines exactly** on (the default), your lines must come back word for word. The app checks this: it restores your exact spelling and warns you if any of your lines are missing. **🎤 Write a vocal melody** asks the composer for a `Vocal` track that sets your chorus to notes, one per syllable. Lyrics are saved with the project, and the composer reads them for mood.

## Play with your keyboard

| Keys | Chord mode (default) | Note mode |
|---|---|---|
| `A S D F G H J K` | Chords I–VII in the song's key, then I up an octave | White keys C D E F G A B C… |
| `W E T Y U O P` | | Black keys |
| `Z` / `X` | Octave down / up | Octave down / up |

`C` switches chord/note mode, `R` records (starts the loop if stopped), and notes snap to the 16th grid. On a drum track the home row plays kick, snare, clap, hat, open hat, tom and rim. Anything you record is **locked** (🔒): Claude has to return it unchanged on every edit, and the app enforces that after each reply. You can lock or unlock any track by hand.

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
- **Lyricist** (`src/shared/lyrics.ts`): returns lyrics line by line with a `mine` flag per line, then checks those flags against your original text.
- **Composer** (`src/shared/composer.ts`): sends the current song plus recent chat to Claude with a JSON schema for the response, so edits build on what's there. The API key never reaches the renderer.
- **Engine** (`src/renderer/src/lib/engine.ts`): synthesized voices per instrument, swing, mute/solo, live edits while playing.
- **Web build** (`vite.web.config.ts`, `src/renderer/src/lib/api.ts`): the same renderer with a browser implementation of the desktop API. Deployed on Vercel as a static site (`vercel.json`).
- **Export**: render a 4× looped WAV offline with the same synths (`renderSong` in `engine.ts`), export a 4× looped Standard MIDI File, or Save/Open `.riff.json` projects. The current song also autosaves to localStorage (`lib/autosave.ts`).

Press **Hear a demo** on the start screen (it loads `examples/late-night-tape.riff.json`) to try Riff without an API key.

## Shortcuts

- `Space`: play / stop
- `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`: undo / redo
- Piano roll: click to add a note (drag to set its length), click a note to delete it

## Ideas for next steps

- Sample-based drum kits and instrument presets
- Song sections (intro / verse / drop) and an arrangement timeline
- Per-track "regenerate just this part" and variations
- MIDI input / output to drive hardware and DAWs

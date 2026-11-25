# Sound credits

Riff's sampled instruments come from two free sources. Both allow use in commercial products and redistribution, as long as the credit below stays with the app.

## Melodic instruments (every folder except `drums/`)

**Fluid (R3) General MIDI SoundFont** by Frank Wen, rendered note by note to MP3 by Benjamin Gleitzman's [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) project.

- FluidR3_GM was released by Frank Wen under the MIT license.
- The midi-js-soundfonts renders are published under the [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/us/) license.

Riff uses the files unchanged; each folder is named after the General MIDI program it was rendered from. Levels are adjusted at playback time.

## Drum kits (`drums/`)

From the sample library that ships with [Sonic Pi](https://github.com/sonic-pi-net/sonic-pi/tree/main/etc/samples) by Sam Aaron. Sonic Pi's sample README states that these samples were donated or taken from freesound.org under the [Creative Commons 0](https://creativecommons.org/publicdomain/zero/1.0/) public-domain dedication. Riff converted them to mono WAV, normalised their peaks and faded long tails at 2.5 seconds. The original freesound authors are listed in Sonic Pi's `etc/samples/README.md`.

## Synth sounds

Synth Kit, Synth Bass, Synth Lead, Synth Pad, Synth Pluck and FM Keys are generated live with Tone.js (MIT) and use no recordings.

To re-download or add instruments, edit `src/shared/instruments.ts` and run `node scripts/fetch-samples.mjs` (needs ffmpeg).

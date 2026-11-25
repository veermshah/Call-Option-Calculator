import type { DrumSound } from './song'
import { SAMPLE_GAIN_DB } from './sampleLevels'

// Every instrument Riff can play. The six original synths keep their ids
// (drums, bass, lead, pad, pluck, keys) so saved songs sound the same; the rest
// play recorded samples that live in src/renderer/public/samples (see
// scripts/fetch-samples.ts and src/renderer/public/samples/CREDITS.md).

export const CATEGORIES = [
  'Drums', 'Bass', 'Keys', 'Organ', 'Mallets', 'Guitar', 'Strings', 'Brass', 'Woodwinds', 'Voices', 'Synths', 'World'
] as const
export type Category = (typeof CATEGORIES)[number]

/** drums: notes are drum sound names. bass: one note at a time. melodic: anything. */
export type Role = 'drums' | 'bass' | 'melodic'

interface Base<I extends string> {
  id: I
  label: string
  category: Category
  role: Role
  /** General MIDI program (0-based) used for MIDI export. */
  gm: number
  /** Comfortable register as MIDI note numbers: shown in the piano roll and told to the composer. */
  home: readonly [number, number]
}

export interface SynthDef<I extends string = string> extends Base<I> { kind: 'synth' }

export interface SampledDef<I extends string = string> extends Base<I> {
  kind: 'sampled'
  /** Folder under /samples, named after the General MIDI program it was rendered from. */
  sample: string
  /** Lowest and highest recorded notes (every 3rd semitone in between is recorded). */
  lo: number
  hi: number
  /** Seconds a note rings on after it is let go. */
  release: number
}

export interface KitDef<I extends string = string> extends Base<I> {
  kind: 'kit'
  /** Sample file (under /samples/drums) for each drum sound, or null for the synthesized kit. */
  sounds: Readonly<Record<DrumSound, string>> | null
}

export type InstrumentDef<I extends string = string> = SynthDef<I> | SampledDef<I> | KitDef<I>

/** The 128 General MIDI program names, in program order (as the sample folders are named). */
export const GM_NAMES = [
  'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honkytonk_piano', 'electric_piano_1',
  'electric_piano_2', 'harpsichord', 'clavinet', 'celesta', 'glockenspiel', 'music_box', 'vibraphone', 'marimba',
  'xylophone', 'tubular_bells', 'dulcimer', 'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ',
  'reed_organ', 'accordion', 'harmonica', 'tango_accordion', 'acoustic_guitar_nylon', 'acoustic_guitar_steel',
  'electric_guitar_jazz', 'electric_guitar_clean', 'electric_guitar_muted', 'overdriven_guitar', 'distortion_guitar',
  'guitar_harmonics', 'acoustic_bass', 'electric_bass_finger', 'electric_bass_pick', 'fretless_bass', 'slap_bass_1',
  'slap_bass_2', 'synth_bass_1', 'synth_bass_2', 'violin', 'viola', 'cello', 'contrabass', 'tremolo_strings',
  'pizzicato_strings', 'orchestral_harp', 'timpani', 'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1',
  'synth_strings_2', 'choir_aahs', 'voice_oohs', 'synth_choir', 'orchestra_hit', 'trumpet', 'trombone', 'tuba',
  'muted_trumpet', 'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2', 'soprano_sax', 'alto_sax',
  'tenor_sax', 'baritone_sax', 'oboe', 'english_horn', 'bassoon', 'clarinet', 'piccolo', 'flute', 'recorder',
  'pan_flute', 'blown_bottle', 'shakuhachi', 'whistle', 'ocarina', 'lead_1_square', 'lead_2_sawtooth',
  'lead_3_calliope', 'lead_4_chiff', 'lead_5_charang', 'lead_6_voice', 'lead_7_fifths', 'lead_8_bass__lead',
  'pad_1_new_age', 'pad_2_warm', 'pad_3_polysynth', 'pad_4_choir', 'pad_5_bowed', 'pad_6_metallic', 'pad_7_halo',
  'pad_8_sweep', 'fx_1_rain', 'fx_2_soundtrack', 'fx_3_crystal', 'fx_4_atmosphere', 'fx_5_brightness', 'fx_6_goblins',
  'fx_7_echoes', 'fx_8_scifi', 'sitar', 'banjo', 'shamisen', 'koto', 'kalimba', 'bagpipe', 'fiddle', 'shanai',
  'tinkle_bell', 'agogo', 'steel_drums', 'woodblock', 'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
  'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet', 'telephone_ring', 'helicopter', 'applause', 'gunshot'
] as const
type GmName = (typeof GM_NAMES)[number]

// MIDI note numbers for readability.
const C1 = 24, C2 = 36, C3 = 48, C4 = 60, C5 = 72, C6 = 84, C7 = 96, C8 = 108
const E1 = 28, E2 = 40, G3 = 55, A5 = 81, G5 = 79, A2 = 45, E5 = 76

const synth = <const I extends string>(id: I, label: string, category: Category, role: Role, gm: number, home: [number, number]): SynthDef<I> =>
  ({ kind: 'synth', id, label, category, role, gm, home })

const sampled = <const I extends string>(
  id: I, label: string, category: Category, sample: GmName, lo: number, hi: number, home: [number, number],
  opts: { role?: Role; release?: number } = {}
): SampledDef<I> => ({
  kind: 'sampled', id, label, category, role: opts.role ?? (category === 'Bass' ? 'bass' : 'melodic'),
  gm: GM_NAMES.indexOf(sample), sample, lo, hi, home, release: opts.release ?? 0.6
})

const kit = <const I extends string>(id: I, label: string, sounds: Record<DrumSound, string> | null): KitDef<I> =>
  ({ kind: 'kit', id, label, category: 'Drums', role: 'drums', gm: 0, home: [0, 0], sounds })

export const CATALOG = [
  // Drums
  kit('drums', 'Synth Kit', null),
  kit('kit-acoustic', 'Acoustic Kit', {
    kick: 'drum_bass_hard', snare: 'drum_snare_hard', clap: 'perc_snap', hat: 'drum_cymbal_closed', openhat: 'drum_cymbal_open',
    tom: 'drum_tom_mid_hard', rim: 'elec_wood', crash: 'drum_splash_hard', ride: 'ride_tri', cowbell: 'drum_cowbell'
  }),
  kit('kit-jazz', 'Jazz Kit', {
    kick: 'bd_jazz', snare: 'drum_snare_soft', clap: 'perc_snap2', hat: 'drum_cymbal_pedal', openhat: 'drum_cymbal_open',
    tom: 'drum_tom_lo_hard', rim: 'elec_wood', crash: 'drum_cymbal_hard', ride: 'ride_via', cowbell: 'drum_cowbell'
  }),
  kit('kit-boombap', 'Boom Bap Kit', {
    kick: 'bd_boom', snare: 'sn_dolf', clap: 'perc_snap2', hat: 'hat_zild', openhat: 'hat_gump',
    tom: 'drum_tom_lo_hard', rim: 'elec_wood', crash: 'drum_splash_hard', ride: 'ride_tri', cowbell: 'drum_cowbell'
  }),
  kit('kit-808', '808 Kit', {
    kick: 'bd_808', snare: 'sn_dub', clap: 'perc_snap', hat: 'hat_tap', openhat: 'hat_cats',
    tom: 'elec_fuzz_tom', rim: 'elec_wood', crash: 'drum_cymbal_hard', ride: 'ride_via', cowbell: 'elec_bell'
  }),
  kit('kit-house', 'House Kit', {
    kick: 'bd_haus', snare: 'sn_generic', clap: 'perc_snap', hat: 'hat_psych', openhat: 'hat_noiz',
    tom: 'drum_tom_mid_hard', rim: 'elec_tick', crash: 'drum_splash_hard', ride: 'ride_tri', cowbell: 'drum_cowbell'
  }),
  kit('kit-electro', 'Electro Kit', {
    kick: 'elec_hollow_kick', snare: 'elec_hi_snare', clap: 'perc_snap2', hat: 'hat_raw', openhat: 'elec_cymbal',
    tom: 'elec_fuzz_tom', rim: 'elec_tick', crash: 'drum_cymbal_hard', ride: 'ride_via', cowbell: 'elec_bell'
  }),

  // Bass
  synth('bass', 'Synth Bass', 'Bass', 'bass', 38, [E1, E2 + 12]),
  sampled('upright-bass', 'Upright Bass', 'Bass', 'acoustic_bass', C1, C4, [E1, G3], { release: 0.3 }),
  sampled('finger-bass', 'Finger Bass', 'Bass', 'electric_bass_finger', C1, C4, [E1, G3], { release: 0.2 }),
  sampled('pick-bass', 'Pick Bass', 'Bass', 'electric_bass_pick', C1, C4, [E1, G3], { release: 0.2 }),
  sampled('fretless-bass', 'Fretless Bass', 'Bass', 'fretless_bass', C1, C4, [E1, G3], { release: 0.3 }),
  sampled('slap-bass', 'Slap Bass', 'Bass', 'slap_bass_1', C1, C4, [E1, G3], { release: 0.2 }),
  sampled('analog-bass', 'Analog Bass', 'Bass', 'synth_bass_1', C1, C4, [E1, G3], { release: 0.2 }),
  sampled('rubber-bass', 'Rubber Bass', 'Bass', 'synth_bass_2', C1, C4, [E1, G3], { release: 0.2 }),

  // Keys
  sampled('piano', 'Grand Piano', 'Keys', 'acoustic_grand_piano', C1, C7, [C3, C5], { release: 1 }),
  sampled('bright-piano', 'Bright Piano', 'Keys', 'bright_acoustic_piano', C1, C7, [C3, C5], { release: 1 }),
  sampled('epiano', 'Electric Piano', 'Keys', 'electric_piano_1', C2, C7, [C3, C5], { release: 0.8 }),
  sampled('fm-epiano', 'FM Electric Piano', 'Keys', 'electric_piano_2', C2, C7, [C3, C5], { release: 0.8 }),
  sampled('honkytonk', 'Honky-tonk Piano', 'Keys', 'honkytonk_piano', C2, C7, [C3, C5], { release: 0.8 }),
  sampled('harpsichord', 'Harpsichord', 'Keys', 'harpsichord', C2, C7, [C3, C5], { release: 0.4 }),
  sampled('clavinet', 'Clavinet', 'Keys', 'clavinet', C2, C7, [C3, C5], { release: 0.2 }),
  synth('keys', 'FM Keys', 'Keys', 'melodic', 4, [C3, C5]),

  // Organ
  sampled('organ', 'Drawbar Organ', 'Organ', 'drawbar_organ', C2, C7, [C3, C5], { release: 0.15 }),
  sampled('rock-organ', 'Rock Organ', 'Organ', 'rock_organ', C2, C7, [C3, C5], { release: 0.15 }),
  sampled('church-organ', 'Church Organ', 'Organ', 'church_organ', C1, C7, [C3, C5], { release: 0.6 }),
  sampled('accordion', 'Accordion', 'Organ', 'accordion', C3, C7, [C3 + 5, C5 + 5], { release: 0.2 }),

  // Mallets & bells
  sampled('vibraphone', 'Vibraphone', 'Mallets', 'vibraphone', C3, C7, [C4, C6], { release: 1.2 }),
  sampled('marimba', 'Marimba', 'Mallets', 'marimba', C3, C7, [C4, C6], { release: 0.6 }),
  sampled('xylophone', 'Xylophone', 'Mallets', 'xylophone', C4, C8, [C5, C7], { release: 0.5 }),
  sampled('glockenspiel', 'Glockenspiel', 'Mallets', 'glockenspiel', C5, C8, [C5, C7], { release: 1.2 }),
  sampled('music-box', 'Music Box', 'Mallets', 'music_box', C4, C8, [C5, C7], { release: 1.2 }),
  sampled('celesta', 'Celesta', 'Mallets', 'celesta', C4, C8, [C5, C7], { release: 1 }),
  sampled('kalimba', 'Kalimba', 'Mallets', 'kalimba', C3, C7, [C4, C6], { release: 0.8 }),
  sampled('steel-drums', 'Steel Drums', 'Mallets', 'steel_drums', C3, C7, [C4, C6], { release: 0.8 }),
  sampled('tubular-bells', 'Tubular Bells', 'Mallets', 'tubular_bells', C3, C6, [C4, C5 + 7], { release: 2 }),

  // Guitar
  sampled('nylon-guitar', 'Nylon Guitar', 'Guitar', 'acoustic_guitar_nylon', C2, C6, [E2, E5], { release: 0.8 }),
  sampled('steel-guitar', 'Acoustic Guitar', 'Guitar', 'acoustic_guitar_steel', C2, C6, [E2, E5], { release: 0.8 }),
  sampled('jazz-guitar', 'Jazz Guitar', 'Guitar', 'electric_guitar_jazz', C2, C6, [E2, E5], { release: 0.6 }),
  sampled('clean-guitar', 'Clean Electric Guitar', 'Guitar', 'electric_guitar_clean', C2, C6, [E2, E5], { release: 0.6 }),
  sampled('muted-guitar', 'Muted Guitar', 'Guitar', 'electric_guitar_muted', C2, C6, [E2, E5], { release: 0.15 }),
  sampled('overdrive-guitar', 'Overdrive Guitar', 'Guitar', 'overdriven_guitar', C2, C6, [E2, E5], { release: 0.3 }),
  sampled('distortion-guitar', 'Distortion Guitar', 'Guitar', 'distortion_guitar', C2, C6, [E2, E5], { release: 0.3 }),

  // Strings
  sampled('violin', 'Violin', 'Strings', 'violin', C3, C7, [G3, A5], { release: 0.4 }),
  sampled('viola', 'Viola', 'Strings', 'viola', C3, C6, [C3 + 7, C5 + 7], { release: 0.4 }),
  sampled('cello', 'Cello', 'Strings', 'cello', C2, C6, [C2, C4 + 7], { release: 0.5 }),
  sampled('strings', 'String Section', 'Strings', 'string_ensemble_1', C2, C7, [C3, C5 + 7], { release: 0.8 }),
  sampled('slow-strings', 'Slow Strings', 'Strings', 'string_ensemble_2', C2, C7, [C3, C5 + 7], { release: 1 }),
  sampled('tremolo-strings', 'Tremolo Strings', 'Strings', 'tremolo_strings', C2, C7, [C3, C5 + 7], { release: 0.5 }),
  sampled('pizzicato', 'Pizzicato Strings', 'Strings', 'pizzicato_strings', C2, C6, [C3, C5 + 7], { release: 0.3 }),
  sampled('harp', 'Harp', 'Strings', 'orchestral_harp', C2, C7, [C3, C6], { release: 1.2 }),
  sampled('synth-strings', 'Synth Strings', 'Strings', 'synth_strings_1', C2, C7, [C3, C5 + 7], { release: 0.8 }),

  // Brass
  sampled('trumpet', 'Trumpet', 'Brass', 'trumpet', C3, C6, [C4 - 6, C6 - 2], { release: 0.25 }),
  sampled('muted-trumpet', 'Muted Trumpet', 'Brass', 'muted_trumpet', C3, C6, [C4 - 6, C6 - 2], { release: 0.25 }),
  sampled('trombone', 'Trombone', 'Brass', 'trombone', C2, C5, [E2, C5 - 2], { release: 0.3 }),
  sampled('french-horn', 'French Horn', 'Brass', 'french_horn', C2, C5, [C3 - 2, C5], { release: 0.4 }),
  sampled('tuba', 'Tuba', 'Brass', 'tuba', C1, C4, [C2 - 6, C3 + 5], { release: 0.3 }),
  sampled('brass', 'Brass Section', 'Brass', 'brass_section', C2, C6, [C3, C5 + 5], { release: 0.3 }),
  sampled('synth-brass', 'Synth Brass', 'Brass', 'synth_brass_1', C2, C6, [C3, C5 + 5], { release: 0.3 }),

  // Woodwinds
  sampled('flute', 'Flute', 'Woodwinds', 'flute', C4, C7, [C4, C6 + 7], { release: 0.25 }),
  sampled('clarinet', 'Clarinet', 'Woodwinds', 'clarinet', C3, C6, [E2 + 12, C6 - 2], { release: 0.25 }),
  sampled('oboe', 'Oboe', 'Woodwinds', 'oboe', C3, C6, [C4 - 2, C6 - 5], { release: 0.25 }),
  sampled('bassoon', 'Bassoon', 'Woodwinds', 'bassoon', C2, C5, [C2 - 2, C4 + 7], { release: 0.25 }),
  sampled('alto-sax', 'Alto Sax', 'Woodwinds', 'alto_sax', C3, C6, [C3 + 1, C5 + 8], { release: 0.25 }),
  sampled('tenor-sax', 'Tenor Sax', 'Woodwinds', 'tenor_sax', C2, C5, [A2, C5 + 3], { release: 0.25 }),
  sampled('pan-flute', 'Pan Flute', 'Woodwinds', 'pan_flute', C4, C7, [C4, C6], { release: 0.4 }),
  sampled('harmonica', 'Harmonica', 'Woodwinds', 'harmonica', C3, C6, [C4, C6], { release: 0.2 }),

  // Voices
  sampled('choir', 'Choir Aahs', 'Voices', 'choir_aahs', C3, C6, [C3, G5], { release: 0.8 }),
  sampled('voice-oohs', 'Voice Oohs', 'Voices', 'voice_oohs', C3, C6, [C3, G5], { release: 0.8 }),

  // Synths
  synth('lead', 'Synth Lead', 'Synths', 'melodic', 81, [C4, C6]),
  synth('pad', 'Synth Pad', 'Synths', 'melodic', 89, [C3, C5]),
  synth('pluck', 'Synth Pluck', 'Synths', 'melodic', 45, [C4, C6]),
  sampled('square-lead', 'Square Lead', 'Synths', 'lead_1_square', C3, C7, [C4, C6], { release: 0.2 }),
  sampled('saw-lead', 'Saw Lead', 'Synths', 'lead_2_sawtooth', C3, C7, [C4, C6], { release: 0.2 }),
  sampled('warm-pad', 'Warm Pad', 'Synths', 'pad_2_warm', C2, C6, [C3, C5], { release: 1.5 }),
  sampled('poly-pad', 'Polysynth Pad', 'Synths', 'pad_3_polysynth', C2, C6, [C3, C5], { release: 1 }),
  sampled('halo-pad', 'Halo Pad', 'Synths', 'pad_7_halo', C2, C6, [C3, C5], { release: 1.5 }),
  sampled('sweep-pad', 'Sweep Pad', 'Synths', 'pad_8_sweep', C2, C6, [C3, C5], { release: 1.5 }),

  // World
  sampled('sitar', 'Sitar', 'World', 'sitar', C3, C6, [C3, C5 + 7], { release: 0.8 }),
  sampled('koto', 'Koto', 'World', 'koto', C3, C7, [C4, C6], { release: 0.8 }),
  sampled('banjo', 'Banjo', 'World', 'banjo', C3, C6, [C3, C5 + 7], { release: 0.5 }),
  sampled('shakuhachi', 'Shakuhachi', 'World', 'shakuhachi', C4, C7, [C4, C6], { release: 0.3 })
] as const satisfies readonly InstrumentDef[]


export type InstrumentId = (typeof CATALOG)[number]['id']

export const INSTRUMENT_IDS = CATALOG.map((d) => d.id) as readonly InstrumentId[]

const BY_ID = new Map<string, InstrumentDef>(CATALOG.map((d) => [d.id, d]))

/** Definition for an id; unknown ids get the FM keys so a bad file still plays. */
export const instrumentDef = (id: string): InstrumentDef => BY_ID.get(id) ?? BY_ID.get('keys')!

export const isInstrument = (id: unknown): id is InstrumentId => typeof id === 'string' && BY_ID.has(id)
export const isDrumKit = (id: string) => instrumentDef(id).role === 'drums'
export const isBassRole = (id: string) => instrumentDef(id).role === 'bass'

/** Instruments grouped for the picker, in catalog order. */
export function instrumentGroups(): { category: Category; items: InstrumentDef[] }[] {
  return CATEGORIES.map((category) => ({ category, items: CATALOG.filter((d) => d.category === category) })).filter((g) => g.items.length)
}

const NOTE_FILE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** File name stem for a MIDI note, matching the sample folders ("Eb4"). */
export const sampleNoteName = (midi: number) => `${NOTE_FILE[midi % 12]}${Math.floor(midi / 12) - 1}`

/** The recorded notes of a sampled instrument (every minor third from lo to hi). */
export function sampleNotes(def: SampledDef): number[] {
  const out: number[] = []
  for (let m = def.lo; m <= def.hi; m += 3) out.push(m)
  return out
}

/** Level correction (dB) measured per instrument so they sit together in a mix. */
export const sampleGainDb = (id: string): number => SAMPLE_GAIN_DB[id] ?? 0

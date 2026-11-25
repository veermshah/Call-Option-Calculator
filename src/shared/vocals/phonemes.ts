// ARPAbet phonemes (the CMU dictionary's set) and the sound of each one for
// the singing synthesizer: formant targets for vowels and voiced consonants,
// noise colour for fricatives and plosive bursts.

export const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'] as const
export const CONSONANTS = [
  'B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH'
] as const
export type Vowel = (typeof VOWELS)[number]
export type Consonant = (typeof CONSONANTS)[number]
export type Phoneme = Vowel | Consonant

const ALL = new Set<string>([...VOWELS, ...CONSONANTS])
export const isVowel = (p: string): p is Vowel => (VOWELS as readonly string[]).includes(p)

/** "L AH1 V" / "l-ah-v" / ["L","AH1","V"] -> ["L","AH","V"]. Unknown symbols are dropped. */
export function parsePhonemes(input: string | string[]): Phoneme[] {
  const parts = Array.isArray(input) ? input : input.split(/[\s,\-.]+/)
  return parts
    .map((p) => p.trim().toUpperCase().replace(/[0-9]/g, ''))
    .filter((p): p is Phoneme => ALL.has(p))
}

/** Formants (Hz) F1-F3 for an adult voice; the synthesizer scales them per voice. */
export const VOWEL_FORMANTS: Record<string, [number, number, number]> = {
  AA: [730, 1090, 2440],
  AE: [660, 1720, 2410],
  AH: [640, 1190, 2390],
  AO: [570, 840, 2410],
  EH: [530, 1840, 2480],
  ER: [490, 1350, 1690],
  IH: [390, 1990, 2550],
  IY: [270, 2290, 3010],
  UH: [440, 1020, 2240],
  UW: [300, 870, 2240],
  // Diphthong start points; the glide target is in DIPHTHONGS.
  AW: [730, 1090, 2440],
  AY: [730, 1090, 2440],
  EY: [530, 1840, 2480],
  OW: [570, 840, 2410],
  OY: [570, 840, 2410]
}

/** Singers hold the first vowel of a diphthong and glide to the second at the end of the note. */
export const DIPHTHONGS: Partial<Record<Vowel, Vowel>> = { AW: 'UH', AY: 'IH', EY: 'IH', OW: 'UH', OY: 'IH' }

export type ConsonantClass = 'stop' | 'fricative' | 'affricate' | 'nasal' | 'liquid' | 'aspirate'

export interface ConsonantSound {
  cls: ConsonantClass
  voiced: boolean
  /** Formant targets the tract moves toward (voiced consonants and transitions). */
  formants: [number, number, number]
  /** Noise band (Hz) for fricatives and bursts. */
  noise?: { freq: number; bw: number; gain: number }
  /** Typical length in seconds. */
  dur: number
}

const NEUTRAL: [number, number, number] = [400, 1300, 2500]

export const CONSONANT_SOUNDS: Record<Consonant, ConsonantSound> = {
  P: { cls: 'stop', voiced: false, formants: [300, 900, 2200], noise: { freq: 900, bw: 1600, gain: 0.5 }, dur: 0.07 },
  B: { cls: 'stop', voiced: true, formants: [300, 900, 2200], noise: { freq: 900, bw: 1600, gain: 0.35 }, dur: 0.06 },
  T: { cls: 'stop', voiced: false, formants: [350, 1700, 2700], noise: { freq: 4500, bw: 3000, gain: 0.55 }, dur: 0.07 },
  D: { cls: 'stop', voiced: true, formants: [350, 1700, 2700], noise: { freq: 4000, bw: 3000, gain: 0.35 }, dur: 0.06 },
  K: { cls: 'stop', voiced: false, formants: [350, 1900, 2400], noise: { freq: 2200, bw: 1400, gain: 0.55 }, dur: 0.08 },
  G: { cls: 'stop', voiced: true, formants: [350, 1900, 2400], noise: { freq: 2000, bw: 1400, gain: 0.35 }, dur: 0.07 },
  F: { cls: 'fricative', voiced: false, formants: [340, 1100, 2400], noise: { freq: 6000, bw: 5000, gain: 0.22 }, dur: 0.1 },
  V: { cls: 'fricative', voiced: true, formants: [340, 1100, 2400], noise: { freq: 6000, bw: 5000, gain: 0.12 }, dur: 0.08 },
  TH: { cls: 'fricative', voiced: false, formants: [350, 1400, 2600], noise: { freq: 6500, bw: 5000, gain: 0.18 }, dur: 0.1 },
  DH: { cls: 'fricative', voiced: true, formants: [350, 1400, 2600], noise: { freq: 6500, bw: 5000, gain: 0.08 }, dur: 0.06 },
  S: { cls: 'fricative', voiced: false, formants: [350, 1600, 2700], noise: { freq: 7000, bw: 2500, gain: 0.5 }, dur: 0.12 },
  Z: { cls: 'fricative', voiced: true, formants: [350, 1600, 2700], noise: { freq: 7000, bw: 2500, gain: 0.3 }, dur: 0.09 },
  SH: { cls: 'fricative', voiced: false, formants: [350, 1800, 2400], noise: { freq: 3200, bw: 1800, gain: 0.5 }, dur: 0.12 },
  ZH: { cls: 'fricative', voiced: true, formants: [350, 1800, 2400], noise: { freq: 3200, bw: 1800, gain: 0.3 }, dur: 0.09 },
  HH: { cls: 'aspirate', voiced: false, formants: NEUTRAL, dur: 0.07 },
  CH: { cls: 'affricate', voiced: false, formants: [350, 1800, 2400], noise: { freq: 3200, bw: 1800, gain: 0.5 }, dur: 0.11 },
  JH: { cls: 'affricate', voiced: true, formants: [350, 1800, 2400], noise: { freq: 3200, bw: 1800, gain: 0.3 }, dur: 0.09 },
  M: { cls: 'nasal', voiced: true, formants: [280, 1000, 2200], dur: 0.08 },
  N: { cls: 'nasal', voiced: true, formants: [280, 1600, 2600], dur: 0.08 },
  NG: { cls: 'nasal', voiced: true, formants: [280, 2000, 2700], dur: 0.09 },
  L: { cls: 'liquid', voiced: true, formants: [360, 1300, 2700], dur: 0.07 },
  R: { cls: 'liquid', voiced: true, formants: [420, 1250, 1650], dur: 0.07 },
  W: { cls: 'liquid', voiced: true, formants: [300, 700, 2200], dur: 0.07 },
  Y: { cls: 'liquid', voiced: true, formants: [280, 2200, 3000], dur: 0.06 }
}

// ---------------------------------------------------------------------------
// Rough spelling-to-sound rules, used when Claude isn't available to give the
// exact phonemes. Good enough to be understood; Claude does better.
// ---------------------------------------------------------------------------

const RULES: [RegExp, string][] = [
  [/^tion/, 'SH AH N'], [/^sion/, 'ZH AH N'], [/^ture/, 'CH ER'],
  [/^igh/, 'AY'], [/^ough/, 'AO'], [/^augh/, 'AO'], [/^eigh/, 'EY'],
  [/^tch/, 'CH'], [/^dge/, 'JH'], [/^sch/, 'S K'],
  [/^ch/, 'CH'], [/^sh/, 'SH'], [/^th/, 'DH'], [/^ph/, 'F'], [/^wh/, 'W'], [/^ng/, 'NG'], [/^ck/, 'K'], [/^qu/, 'K W'],
  [/^kn/, 'N'], [/^wr/, 'R'], [/^gh/, 'G'],
  [/^ee/, 'IY'], [/^ea/, 'IY'], [/^oo/, 'UW'], [/^ou/, 'AW'], [/^ow/, 'OW'], [/^oa/, 'OW'], [/^oi/, 'OY'], [/^oy/, 'OY'],
  [/^ai/, 'EY'], [/^ay/, 'EY'], [/^ey/, 'EY'], [/^ie/, 'IY'], [/^au/, 'AO'], [/^aw/, 'AO'], [/^ew/, 'UW'], [/^ue/, 'UW'],
  [/^ar/, 'AA R'], [/^er/, 'ER'], [/^ir/, 'ER'], [/^ur/, 'ER'], [/^or/, 'AO R'],
  [/^a/, 'AE'], [/^e/, 'EH'], [/^i/, 'IH'], [/^o/, 'AA'], [/^u/, 'AH'], [/^y/, 'IY'],
  [/^b/, 'B'], [/^c(?=[eiy])/, 'S'], [/^c/, 'K'], [/^d/, 'D'], [/^f/, 'F'], [/^g(?=[eiy])/, 'JH'], [/^g/, 'G'], [/^h/, 'HH'],
  [/^j/, 'JH'], [/^k/, 'K'], [/^l/, 'L'], [/^m/, 'M'], [/^n/, 'N'], [/^p/, 'P'], [/^q/, 'K'], [/^r/, 'R'], [/^s/, 'S'],
  [/^t/, 'T'], [/^v/, 'V'], [/^w/, 'W'], [/^x/, 'K S'], [/^z/, 'Z']
]

const COMMON: Record<string, string> = {
  the: 'DH AH', a: 'AH', i: 'AY', you: 'Y UW', to: 'T UW', of: 'AH V', is: 'IH Z', my: 'M AY', me: 'M IY', we: 'W IY',
  be: 'B IY', he: 'HH IY', she: 'SH IY', so: 'S OW', no: 'N OW', go: 'G OW', oh: 'OW', love: 'L AH V', one: 'W AH N',
  are: 'AA R', your: 'Y AO R', were: 'W ER', was: 'W AH Z', have: 'HH AE V', do: 'D UW', what: 'W AH T', come: 'K AH M',
  some: 'S AH M', heart: 'HH AA R T', night: 'N AY T', light: 'L AY T', eyes: 'AY Z', all: 'AO L', don: 'D OW N', said: 'S EH D'
}

function wordToPhonemes(word: string): Phoneme[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return []
  if (COMMON[w]) return parsePhonemes(COMMON[w])
  // Silent final e makes the vowel before it long ("time", "home").
  let body = w
  let longVowel = false
  if (body.length > 3 && body.endsWith('e') && !/[aeiou]e$/.test(body) && /[aeiou][^aeiou]e$/.test(body)) {
    body = body.slice(0, -1)
    longVowel = true
  }
  const out: string[] = []
  let rest = body
  while (rest) {
    const rule = RULES.find(([re]) => re.test(rest))
    if (!rule) { rest = rest.slice(1); continue }
    const m = rest.match(rule[0])!
    out.push(rule[1])
    rest = rest.slice(m[0].length)
  }
  let ph = parsePhonemes(out.join(' '))
  if (longVowel) {
    const LONG: Record<string, Phoneme> = { AE: 'EY', EH: 'IY', IH: 'AY', AA: 'OW', AH: 'UW' }
    for (let i = ph.length - 1; i >= 0; i--) if (isVowel(ph[i])) { ph[i] = LONG[ph[i]] ?? ph[i]; break }
  }
  // Collapse doubled letters ("ll", "ss").
  ph = ph.filter((p, i) => i === 0 || p !== ph[i - 1] || isVowel(p))
  return ph
}

/** Split a word's phonemes into syllables: each vowel with the consonants before it, leftovers to the last. */
function syllabify(ph: Phoneme[]): Phoneme[][] {
  const out: Phoneme[][] = []
  let cur: Phoneme[] = []
  for (const p of ph) {
    cur.push(p)
    if (isVowel(p)) { out.push(cur); cur = [] }
  }
  if (cur.length) {
    if (out.length) {
      // Give the last syllable the trailing consonants; split clusters between vowels.
      out[out.length - 1].push(...cur)
    } else out.push(cur)
  }
  // Move one consonant of a cluster to the next syllable's onset ("win-ter").
  for (let i = 0; i < out.length - 1; i++) {
    const next = out[i + 1]
    let onset = 0
    while (onset < next.length && !isVowel(next[onset])) onset++
    if (onset >= 2) out[i].push(next.shift()!)
  }
  return out.filter((s) => s.length)
}

/** Lyrics text -> a flat list of sung syllables with their phonemes. */
export function guessSyllables(lyrics: string): { text: string; phonemes: Phoneme[] }[] {
  const words = lyrics
    .split('\n')
    .filter((l) => !/^\s*\[.*\]\s*$/.test(l))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
  const out: { text: string; phonemes: Phoneme[] }[] = []
  for (const word of words) {
    const syl = syllabify(wordToPhonemes(word))
    syl.forEach((phonemes, i) => out.push({ text: syl.length > 1 ? `${word.replace(/[^\w']/g, '')}${i ? `(${i + 1})` : ''}` : word.replace(/[^\w']/g, ''), phonemes }))
  }
  return out
}

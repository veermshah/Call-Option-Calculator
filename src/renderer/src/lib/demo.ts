import { normalizeSong, type Song } from '@shared/song'
import lateNightTape from '../../../../examples/late-night-tape.riff.json'

/** A finished loop to hear (and remix) before writing anything yourself. */
export const demoSong = (): Song => normalizeSong(lateNightTape)

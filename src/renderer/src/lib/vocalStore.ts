// Vocal audio lives in IndexedDB: a take is megabytes, far too big for the
// song file or localStorage. Every call is guarded; without storage the takes
// still work for this session and are just not kept after a refresh.

export interface StoredAudio {
  sampleRate: number
  data: Float32Array
}

const DB = 'riff-vocals'
const STORE = 'audio'
let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export const putValue = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).then((r) => r !== null)
export const getValue = <T>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>)
export const putAudio = (key: string, audio: StoredAudio) => putValue(key, audio)
export const getAudio = (key: string) => getValue<StoredAudio>(key)

/** Drop stored audio of takes that are no longer in the song. */
export async function pruneVocals(keepIds: string[]) {
  const keys = await run('readonly', (s) => s.getAllKeys())
  if (!keys) return
  const keep = new Set(keepIds)
  for (const k of keys) {
    const id = String(k).split(':')[0]
    if (!keep.has(id)) await run('readwrite', (s) => s.delete(k))
  }
}

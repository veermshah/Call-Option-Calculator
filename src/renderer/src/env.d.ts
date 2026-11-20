import type { RiffApi } from '@shared/ipc'

declare global {
  interface Window {
    riff: RiffApi
  }
}
export {}

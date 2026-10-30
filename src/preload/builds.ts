// preload/builds.ts — the Builds read, spread into both `window.eq` (the tab) and `window.eqOverlay`
// (the builds overlay), which draw the same payload.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { BuildsPayload } from '../shared/builds'

export const buildsBridge = {
  /** Every build file, the active character's worn cells, and each build item's source. */
  getBuilds: (): Promise<BuildsPayload> => ipcRenderer.invoke(IPC.buildsGet)
}

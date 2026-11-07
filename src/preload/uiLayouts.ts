// preload/uiLayouts.ts — saved EverQuest UI layouts (src/shared/uiLayouts.ts), spread into
// `window.eq`.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { UiLayoutsResult } from '../shared/uiLayouts'

export const uiLayoutsBridge = {
  listUiLayouts: (): Promise<UiLayoutsResult> => ipcRenderer.invoke(IPC.uiLayoutsList),
  /** Copy the install folder's UI_*.ini files into the layout `name`. */
  saveUiLayout: (name: string): Promise<UiLayoutsResult> => ipcRenderer.invoke(IPC.uiLayoutsSave, name),
  /** Copy the layout `name` over the install folder's UI_*.ini files. */
  applyUiLayout: (name: string): Promise<UiLayoutsResult> => ipcRenderer.invoke(IPC.uiLayoutsApply, name),
  deleteUiLayout: (name: string): Promise<UiLayoutsResult> => ipcRenderer.invoke(IPC.uiLayoutsDelete, name)
}

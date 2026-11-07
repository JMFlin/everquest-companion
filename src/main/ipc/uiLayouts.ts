// IPC: saved EverQuest UI layouts (src/shared/uiLayouts.ts states the feature, ../uiLayouts.ts
// does the file work).
//
// Every channel answers `UiLayoutsResult`: the current list, plus an `error` sentence when the
// operation was refused or failed, which the Preferences card prints as-is. Save and apply are
// refused while EverQuest is running, because it rewrites its UI files on camp and quit and would
// overwrite an applied layout. The check trusts the presence watcher only once it has reported
// (`observed`); before that `eqRunning` is an unmeasured default.

import { app, ipcMain } from 'electron'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import { normalizeUiLayoutName, type UiLayoutsResult } from '../../shared/uiLayouts'
import { effectiveEqRoot } from '../log/config'
import { presenceSnapshot } from '../presence'
import { applyUiLayout, deleteUiLayout, listUiLayouts, saveUiLayout } from '../uiLayouts'

const storeDir = (): string => join(app.getPath('userData'), 'ui-layouts')
const backupDir = (): string => join(app.getPath('userData'), 'ui-layouts-backup')

function answer(op: (name: string) => void, rawName: unknown, needsEqClosed: boolean): UiLayoutsResult {
  const name = normalizeUiLayoutName(rawName)
  let error: string | undefined
  if (name === null) {
    error = 'Use 1-32 letters, digits, spaces, _ or -.'
  } else if (needsEqClosed && presenceSnapshot().observed && presenceSnapshot().eqRunning) {
    error = 'Quit EverQuest first. It rewrites its UI files when you camp or quit.'
  } else {
    try {
      op(name)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }
  return { layouts: listUiLayouts(storeDir()), ...(error === undefined ? {} : { error }) }
}

export function registerUiLayoutsIpc(): void {
  ipcMain.handle(IPC.uiLayoutsList, (): UiLayoutsResult => ({ layouts: listUiLayouts(storeDir()) }))
  ipcMain.handle(IPC.uiLayoutsSave, (_e, name: unknown) =>
    answer((n) => { saveUiLayout(effectiveEqRoot(), storeDir(), n, Date.now()) }, name, true)
  )
  ipcMain.handle(IPC.uiLayoutsApply, (_e, name: unknown) =>
    answer((n) => { applyUiLayout(effectiveEqRoot(), storeDir(), n, backupDir()) }, name, true)
  )
  ipcMain.handle(IPC.uiLayoutsDelete, (_e, name: unknown) =>
    answer((n) => { deleteUiLayout(storeDir(), n) }, name, false)
  )
}

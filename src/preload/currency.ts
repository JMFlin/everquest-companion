// preload/currency.ts — hand statements about held counts: one item by hand, or a whole
// currency-window scan. Spread into `window.eq`; the scan pair also into `window.eqOverlay`
// (the motes overlay carries the same Scan button). Its own module because index.ts sits at the
// 400-code-line ceiling.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CurrencyScanResult } from '../shared/currencyScan'
import type { ProgressState } from '../shared/types'
import type { ItemCountOverride } from '../shared/itemOverrides'

/** The scan pair alone — all the overlay gets. */
export const scanBridge = {
  /** A Scan button is on screen: load the OCR workers ahead of the first press. */
  warmCurrencyScan: (): Promise<void> => ipcRenderer.invoke(IPC.warmCurrencyScan),
  /** Stop the scan in progress; its `scanCurrency` promise answers `cancelled`. */
  cancelCurrencyScan: (): Promise<void> => ipcRenderer.invoke(IPC.cancelCurrencyScan),
  /** Capture the EverQuest window and read its currency list. Nothing is stored until applied. */
  scanCurrency: (): Promise<CurrencyScanResult> => ipcRenderer.invoke(IPC.scanCurrency),
  /** The held-count statements in force (the overlay counts held motes from these + loot). */
  getHeldStatements: (): Promise<ItemCountOverride[]> => ipcRenderer.invoke(IPC.getHeldStatements),
  /** A scan was saved; re-read the statements. */
  onHeldStatements: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.onHeldStatements, listener)
    return () => ipcRenderer.removeListener(IPC.onHeldStatements, listener)
  }
}

export const currencyBridge = {
  /**
   * State ONE item's held count by hand, or take the statement back with `count: null` (JOS-186).
   * `key` is the normalized counting key; `name` is only ever a spelling. Main dates the statement
   * and sanitizes it (shared/itemOverrides.ts owns both rules).
   */
  setItemOverride: (key: string, name: string, count: number | null): Promise<ProgressState> =>
    ipcRenderer.invoke(IPC.setItemOverride, key, name, count),
  ...scanBridge
}

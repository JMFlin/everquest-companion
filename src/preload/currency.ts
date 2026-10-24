// preload/currency.ts — hand statements about held counts: one item by hand, or a whole
// currency-window scan. Spread into `window.eq`; the scan pair also into `window.eqOverlay`
// (the motes overlay carries the same Scan button). Its own module because index.ts sits at the
// 400-code-line ceiling.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CurrencyScanResult } from '../shared/currencyScan'
import type { ProgressState } from '../shared/types'

/** The scan pair alone — all the overlay gets. */
export const scanBridge = {
  /** A Scan button is on screen: load the OCR workers ahead of the first press. */
  warmCurrencyScan: (): Promise<void> => ipcRenderer.invoke(IPC.warmCurrencyScan),
  /** Capture the EverQuest window and read its currency list. Nothing is stored until applied. */
  scanCurrency: (): Promise<CurrencyScanResult> => ipcRenderer.invoke(IPC.scanCurrency),
  /** Confirm a scan: main states every vocabulary item's count (absent ⇒ 0) as of now. */
  applyCurrencyScan: (counts: Record<string, number>): Promise<ProgressState> =>
    ipcRenderer.invoke(IPC.applyCurrencyScan, counts)
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

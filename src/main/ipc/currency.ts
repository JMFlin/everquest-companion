// IPC: scan the EverQuest currency window, and confirm a scan into held-count statements.
// A confirmed scan states EVERY vocabulary item (an item the window did not list is 0), dated now,
// so loot after it still counts forward (shared/itemOverrides.ts).

import { app, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CurrencyScanResult } from '../../shared/currencyScan'
import { captureEqWindow } from '../currencyScan/captureEqWindow'
import { findOcrLangDir, readCurrencyWindow } from '../currencyScan'
import { currencyVocabulary } from '../currencyScan/vocabulary'
import { activeCharId } from '../session'
import { setItemOverride } from '../storeItemOverrides'
import { sendToMain } from '../windows'

async function scan(): Promise<CurrencyScanResult> {
  const png = await captureEqWindow()
  if (!png) return { ok: false, error: 'eq-window-not-found' }
  const langDir = findOcrLangDir(app.getAppPath(), process.resourcesPath, process.cwd())
  if (!langDir) throw new Error('OCR language data (resources/ocr/eng.traineddata) is missing')
  const r = await readCurrencyWindow(png, langDir)
  return 'error' in r ? { ok: false, error: r.error } : { ok: true, ...r }
}

export function registerCurrencyIpc(): void {
  ipcMain.handle(IPC.scanCurrency, () => scan())
  ipcMain.handle(IPC.applyCurrencyScan, (_e, counts: Record<string, number>) => {
    const vocab = currencyVocabulary()
    for (const name of Object.keys(counts)) {
      if (!vocab.includes(name)) throw new Error(`not a currency item: ${name}`)
    }
    const charId = activeCharId()
    let progress = null
    for (const name of vocab) progress = setItemOverride(charId, name.toLowerCase(), name, counts[name] ?? 0)
    sendToMain(IPC.onProgress, progress)
    return progress
  })
}

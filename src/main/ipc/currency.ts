// IPC: scan the EverQuest currency window, and confirm a scan into held-count statements.
// A confirmed scan states EVERY vocabulary item (an item the window did not list is 0), dated now,
// so loot after it still counts forward (shared/itemOverrides.ts).

import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type { CurrencyScanResult } from '../../shared/currencyScan'
import { captureEqImages } from '../currencyScan/captureEqWindow'
import { findOcrLangDir, readCurrencyWindow } from '../currencyScan'
import { currencyVocabulary } from '../currencyScan/vocabulary'
import { decodePng, encodePng } from '../currencyScan/png'
import { activeCharId } from '../session'
import { setItemOverride } from '../storeItemOverrides'
import { sendToMain } from '../windows'

async function scan(): Promise<CurrencyScanResult> {
  const images = await captureEqImages()
  if (images.length === 0) return { ok: false, error: 'eq-window-not-found' }
  // The last scan's captures stay on disk (overwritten each scan) so a misread can be inspected.
  const dir = join(app.getPath('userData'), 'currency-scan')
  mkdirSync(dir, { recursive: true })
  images.forEach((png, i) => writeFileSync(join(dir, `capture-${i}.png`), png))
  const langDir = findOcrLangDir(app.getAppPath(), process.resourcesPath, process.cwd())
  if (!langDir) throw new Error('OCR language data (resources/ocr/eng.traineddata) is missing')
  // The header strip from the last good scan: lets the next one find the window by pixels.
  const fpPath = join(dir, 'fingerprint.png')
  const fingerprint = existsSync(fpPath) ? decodePng(readFileSync(fpPath)) : undefined
  for (const png of images) {
    const r = await readCurrencyWindow(png, langDir, fingerprint)
    if (!('error' in r)) {
      writeFileSync(fpPath, encodePng(r.fingerprint))
      const zeroed = currencyVocabulary().filter((n) => !(n in r.counts))
      return { ok: true, counts: r.counts, unmatched: r.unmatched, zeroed }
    }
  }
  return { ok: false, error: 'not-currency-window' }
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

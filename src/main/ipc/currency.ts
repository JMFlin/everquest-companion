// IPC: scan the EverQuest currency window, and confirm a scan into held-count statements.
// A confirmed scan states EVERY vocabulary item (an item the window did not list is 0), dated now,
// so loot after it still counts forward (shared/itemOverrides.ts).

import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type { CurrencyScanResult } from '../../shared/currencyScan'
import { captureEqImages } from '../currencyScan/captureEqWindow'
import { createCurrencyReader, findOcrLangDir, type CurrencyReader, type Fingerprint } from '../currencyScan'
import { currencyVocabulary } from '../currencyScan/vocabulary'
import { decodePng, encodePng } from '../currencyScan/png'
import { activeCharId } from '../session'
import { setItemOverride } from '../storeItemOverrides'
import { sendToMain } from '../windows'

/** OCR workers stay up this long after the last warm/scan, so a scan right after opening is fast. */
const IDLE_CLOSE_MS = 3 * 60_000

let reader: Promise<CurrencyReader> | null = null
let idle: NodeJS.Timeout | null = null

/** The shared reader, started on first use; every use pushes back its idle close. */
function useReader(): Promise<CurrencyReader> {
  if (!reader) {
    const langDir = findOcrLangDir(app.getAppPath(), process.resourcesPath, process.cwd())
    if (!langDir) throw new Error('OCR language data (resources/ocr/eng.traineddata) is missing')
    reader = createCurrencyReader(langDir)
  }
  if (idle) clearTimeout(idle)
  const current = reader
  idle = setTimeout(() => {
    reader = null
    void current.then((r) => r.close())
  }, IDLE_CLOSE_MS)
  return current
}

function scanDir(): string {
  const dir = join(app.getPath('userData'), 'currency-scan')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The header strip + column layout from the last good scan, stored as a PNG and its JSON. */
function loadFingerprint(dir: string): Fingerprint | undefined {
  const png = join(dir, 'fingerprint.png')
  const json = join(dir, 'fingerprint.json')
  if (!existsSync(png) || !existsSync(json)) return undefined
  return { strip: decodePng(readFileSync(png)), header: JSON.parse(readFileSync(json, 'utf8')) as Fingerprint['header'] }
}

function saveFingerprint(dir: string, fp: Fingerprint): void {
  writeFileSync(join(dir, 'fingerprint.png'), encodePng(fp.strip))
  writeFileSync(join(dir, 'fingerprint.json'), JSON.stringify(fp.header))
}

async function scan(): Promise<CurrencyScanResult> {
  const ocr = useReader()
  const images = await captureEqImages()
  if (images.length === 0) return { ok: false, error: 'eq-window-not-found' }
  // The last scan's captures stay on disk (overwritten each scan) so a misread can be inspected.
  const dir = scanDir()
  images.forEach((png, i) => writeFileSync(join(dir, `capture-${i}.png`), png))
  const fingerprint = loadFingerprint(dir)
  for (const png of images) {
    const r = await (await ocr).read(png, fingerprint)
    if (!('error' in r)) {
      saveFingerprint(dir, r.fingerprint)
      const zeroed = currencyVocabulary().filter((n) => !(n in r.counts))
      return { ok: true, counts: r.counts, unmatched: r.unmatched, zeroed }
    }
  }
  return { ok: false, error: 'not-currency-window' }
}

export function registerCurrencyIpc(): void {
  // A surface that offers Scan asks for this when it opens: the workers load while the user lines
  // up the game window, not after they press the button.
  ipcMain.handle(IPC.warmCurrencyScan, async () => {
    await useReader()
  })
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

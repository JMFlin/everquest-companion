// IPC: scan the EverQuest currency window, and confirm a scan into held-count statements.
// A confirmed scan states EVERY vocabulary item (an item the window did not list is 0), dated now,
// so loot after it still counts forward (shared/itemOverrides.ts).

import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
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
/** Bumped by a cancel; a scan that started under an older value answers `cancelled`. */
let generation = 0
/** Resolvers of the scans in flight; a cancel answers them at once. */
const waiting = new Set<() => void>()

/**
 * Stop any scan: its caller is answered `cancelled` now, and the workers are terminated (which
 * does NOT reject the recognize call in flight, so that call is simply abandoned).
 */
function cancel(): void {
  generation++
  for (const answer of waiting) answer()
  waiting.clear()
  if (idle) clearTimeout(idle)
  const current = reader
  reader = null
  void current?.then((r) => r.close())
}

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

/** One fingerprint per UI size (laptop, monitor, ...) so switching screens stays fast. */
const MAX_FINGERPRINTS = 4

/**
 * The saved header strips + column layouts, newest first. Each is `fp-<strip height>.png` with
 * its `.json`; the strip height names the UI size, so a rescan at a known size replaces its own.
 */
function loadFingerprints(dir: string): Fingerprint[] {
  return savedStrips(dir)
    .filter((f) => existsSync(join(dir, f.replace(/png$/, 'json'))))
    .map((f) => ({
      strip: decodePng(readFileSync(join(dir, f))),
      header: JSON.parse(readFileSync(join(dir, f.replace(/png$/, 'json')), 'utf8')) as Fingerprint['header']
    }))
}

function saveFingerprint(dir: string, fp: Fingerprint): void {
  const base = join(dir, `fp-${fp.strip.height}`)
  writeFileSync(`${base}.png`, encodePng(fp.strip))
  writeFileSync(`${base}.json`, JSON.stringify(fp.header))
  for (const f of savedStrips(dir).slice(MAX_FINGERPRINTS)) {
    rmSync(join(dir, f))
    rmSync(join(dir, f.replace(/png$/, 'json')), { force: true })
  }
}

/** Saved strip file names, newest first. */
function savedStrips(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^fp-\d+\.png$/.test(f))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map(({ f }) => f)
}

async function scan(): Promise<CurrencyScanResult> {
  const mine = generation
  let answer = (): void => undefined
  const stopped = new Promise<CurrencyScanResult>((resolve) => {
    answer = () => resolve({ ok: false, error: 'cancelled' })
    waiting.add(answer)
  })
  try {
    const work = scanOnce(() => mine !== generation)
    // A cancelled scan's work is abandoned, not awaited: its late failure must not go unhandled.
    work.catch(() => undefined)
    return await Promise.race([work, stopped])
  } finally {
    waiting.delete(answer)
  }
}

async function scanOnce(cancelled: () => boolean): Promise<CurrencyScanResult> {
  const ocr = useReader()
  const { images, minimized } = await captureEqImages()
  if (minimized) return { ok: false, error: 'eq-minimized' }
  if (images.length === 0) return { ok: false, error: 'eq-window-not-found' }
  // The last scan's captures stay on disk (overwritten each scan) so a misread can be inspected.
  const dir = scanDir()
  images.forEach((png, i) => writeFileSync(join(dir, `capture-${i}.png`), png))
  const fingerprints = loadFingerprints(dir)
  for (const png of images) {
    if (cancelled()) return { ok: false, error: 'cancelled' }
    const r = await (await ocr).read(png, fingerprints)
    if (cancelled()) return { ok: false, error: 'cancelled' }
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
  ipcMain.handle(IPC.cancelCurrencyScan, () => {
    cancel()
  })
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

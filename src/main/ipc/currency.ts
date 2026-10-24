// IPC: scan the EverQuest currency window. A scan that reads every row is saved at once as
// held-count statements: EVERY vocabulary item (an item the window did not list is 0), dated now,
// so loot after it still counts forward (shared/itemOverrides.ts). With auto rescan on, the game is
// captured every AUTO_RESCAN_MS and read only when a saved fingerprint shows the window is open.

import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type { AutoRescanState, CurrencyScanResult } from '../../shared/currencyScan'
import { captureEqImages } from '../currencyScan/captureEqWindow'
import { createCurrencyReader, findOcrLangDir, showsCurrencyWindow, type CurrencyReader, type CurrencyScan, type Fingerprint } from '../currencyScan'
import { currencyVocabulary } from '../currencyScan/vocabulary'
import { mergeReads } from '../currencyScan/merge'
import { logError, logInfo } from '../errorLog'
import { decodePng, encodePng } from '../currencyScan/png'
import { activeCharId } from '../session'
import { settingsStore } from '../store'
import { getItemOverrides, setItemOverride } from '../storeItemOverrides'
import { getOverlayWindow, sendToMain } from '../windows'

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

/** `background`: an auto rescan, which reads only captures a saved fingerprint matches. */
async function scan(background: boolean): Promise<CurrencyScanResult> {
  const mine = generation
  let answer = (): void => undefined
  const stopped = new Promise<CurrencyScanResult>((resolve) => {
    answer = () => resolve({ ok: false, error: 'cancelled' })
    waiting.add(answer)
  })
  try {
    const work = scanOnce(() => mine !== generation, background)
    // A cancelled scan's work is abandoned, not awaited: its late failure must not go unhandled.
    work.catch(() => undefined)
    return await Promise.race([work, stopped])
  } finally {
    waiting.delete(answer)
  }
}

async function scanOnce(cancelled: () => boolean, background: boolean): Promise<CurrencyScanResult> {
  // A Scan press starts the workers alongside the capture; a background rescan only once it matched.
  const early = background ? null : useReader()
  const { images: captured, minimized } = await captureEqImages()
  if (minimized) return { ok: false, error: 'eq-minimized' }
  if (captured.length === 0) return { ok: false, error: 'eq-window-not-found' }
  const dir = scanDir()
  const fingerprints = loadFingerprints(dir)
  const images = background ? captured.filter((png) => showsCurrencyWindow(png, fingerprints)) : captured
  if (images.length === 0) return { ok: false, error: 'not-currency-window' }
  // The last scan's captures stay on disk (overwritten each scan) so a misread can be inspected.
  images.forEach((png, i) => writeFileSync(join(dir, `capture-${i}.png`), png))
  const reads = await readCaptures(await (early ?? useReader()), images, fingerprints, cancelled)
  if (reads === 'cancelled') return { ok: false, error: 'cancelled' }
  if (reads.length === 0) return { ok: false, error: 'not-currency-window' }
  saveFingerprint(dir, reads[0].fingerprint)
  const merged = mergeReads(reads)
  const zeroed = currencyVocabulary().filter((n) => !(n in merged.counts))
  // A complete read is saved at once; an unreadable row would be stated as 0, so otherwise nothing
  // is saved and the user rescans.
  if (merged.complete) state(merged.counts)
  logInfo(`[currency-scan] ${merged.complete ? 'saved' : 'not saved'} from ${reads.length} capture(s)`)
  return { ok: true, counts: merged.counts, unmatched: merged.unmatched, zeroed, saved: merged.complete }
}

/**
 * Each capture that shows the window is another read of it: read them in order and stop at the
 * first point the reads so far are complete on their own or merged (mergeReads).
 */
async function readCaptures(
  ocr: CurrencyReader,
  images: readonly Buffer[],
  fingerprints: readonly Fingerprint[],
  cancelled: () => boolean
): Promise<Extract<CurrencyScan, { counts: unknown }>[] | 'cancelled'> {
  const reads: Extract<CurrencyScan, { counts: unknown }>[] = []
  for (const [i, png] of images.entries()) {
    if (cancelled()) return 'cancelled'
    const r = await ocr.read(png, fingerprints)
    if (cancelled()) return 'cancelled'
    if ('error' in r) {
      logInfo(`[currency-scan] capture-${i}: ${r.error}`)
      continue
    }
    logInfo(
      `[currency-scan] capture-${i}: ${Object.keys(r.counts).length} rows read${r.unmatched.length ? `, unreadable: ${r.unmatched.join(' / ')}` : ''}`
    )
    reads.push(r)
    if (mergeReads(reads).complete) break
  }
  return reads
}

/**
 * Every vocabulary item becomes a hand statement dated now (absent from the window ⇒ 0). Both
 * windows hear about it: the main one through its progress push, the motes overlay directly.
 */
function state(counts: Record<string, number>): void {
  const charId = activeCharId()
  let progress = null
  for (const name of currencyVocabulary()) {
    progress = setItemOverride(charId, name.toLowerCase(), name, counts[name] ?? 0)
  }
  sendToMain(IPC.onProgress, progress)
  getOverlayWindow('motes')?.webContents.send(IPC.onHeldStatements)
}

const AUTO_RESCAN_MS = 45_000

let autoTimer: NodeJS.Timeout | null = null
let autoUpdatedAt: number | null = null
let autoNextAt: number | null = null
/** The background rescan in flight; a Scan press waits for it instead of sharing the workers. */
let background: Promise<void> | null = null

function autoRescanState(): AutoRescanState {
  return { enabled: settingsStore.get('autoRescan') ?? false, updatedAt: autoUpdatedAt, nextAt: autoNextAt }
}

function pushAutoRescan(): void {
  const s = autoRescanState()
  sendToMain(IPC.onAutoRescan, s)
  getOverlayWindow('motes')?.webContents.send(IPC.onAutoRescan, s)
}

function scheduleAutoRescan(): void {
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = autoRescanState().enabled ? setInterval(autoRescan, AUTO_RESCAN_MS) : null
  autoNextAt = autoTimer ? Date.now() + AUTO_RESCAN_MS : null
}

function autoRescan(): void {
  autoNextAt = Date.now() + AUTO_RESCAN_MS
  pushAutoRescan()
  if (background || waiting.size > 0) return
  background = scan(true)
    .then((r) => {
      if (!r.ok || !r.saved) return
      autoUpdatedAt = Date.now()
      pushAutoRescan()
    })
    .catch((e: unknown) => logError('currency-auto-rescan', e))
    .finally(() => {
      background = null
    })
}

export function registerCurrencyIpc(): void {
  scheduleAutoRescan()
  ipcMain.handle(IPC.getAutoRescan, () => autoRescanState())
  ipcMain.handle(IPC.setAutoRescan, (_e, enabled: boolean) => {
    settingsStore.set('autoRescan', enabled)
    scheduleAutoRescan()
    // Ticking the box rescans at once; the countdown runs from there.
    if (enabled) autoRescan()
    else pushAutoRescan()
    return autoRescanState()
  })
  // A surface that offers Scan asks for this when it opens: the workers load while the user lines
  // up the game window, not after they press the button.
  ipcMain.handle(IPC.warmCurrencyScan, async () => {
    await useReader()
  })
  ipcMain.handle(IPC.scanCurrency, async () => {
    await background
    return scan(false)
  })
  ipcMain.handle(IPC.cancelCurrencyScan, () => {
    cancel()
  })
  // The overlay has no progress record of its own; it reads the statements to count held motes.
  ipcMain.handle(IPC.getHeldStatements, () => getItemOverrides(activeCharId()))
}

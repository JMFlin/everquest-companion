// IPC: scan the EverQuest currency window. A scan that reads every row is saved at once as
// held-count statements: EVERY vocabulary item (an item the window did not list is 0), dated now,
// so loot after it still counts forward (shared/itemOverrides.ts). With auto rescan on, the game is
// captured every AUTO_RESCAN_MS and read only when a saved fingerprint shows the window is open.

import { app, ipcMain } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type { AutoRescanState, CurrencyScanResult } from '../../shared/currencyScan'
import { captureEqImages } from '../currencyScan/captureEqWindow'
import { findOcrLangDir } from '../currencyScan'
import { currencyVocabulary } from '../currencyScan/vocabulary'
import { logError, logInfo } from '../errorLog'
import type { ScanReply, ScanRequest, ScanWorkerData } from '../currencyScanWorker'
import { activeCharId } from '../session'
import { settingsStore } from '../store'
import { getItemOverrides, setItemOverride } from '../storeItemOverrides'
import { getOverlayWindow, sendToMain } from '../windows'

/** The scan worker (and its OCR workers) stays up this long after the last warm/scan. */
const IDLE_CLOSE_MS = 3 * 60_000

let worker: Worker | null = null
let idle: NodeJS.Timeout | null = null
let nextId = 0
/** Scans waiting on the worker; `null` answers one that was stopped (the worker exited). */
const pending = new Map<number, (reply: ScanReply | null) => void>()
/** Bumped by a cancel, so a scan still capturing when Stop is pressed answers `cancelled`. */
let generation = 0

/** The scan worker, started on first use; every use pushes back its idle close. */
function useWorker(): Worker {
  if (!worker) {
    const langDir = findOcrLangDir(app.getAppPath(), process.resourcesPath, process.cwd())
    if (!langDir) throw new Error('OCR language data (resources/ocr/eng.traineddata) is missing')
    const w = new Worker(join(__dirname, 'currencyScanWorker.js'), { workerData: { langDir } satisfies ScanWorkerData })
    w.on('message', (reply: ScanReply) => {
      pending.get(reply.id)?.(reply)
      pending.delete(reply.id)
    })
    w.on('error', (e) => logError('currency-scan-worker', e))
    w.on('exit', () => {
      if (worker === w) worker = null
      for (const answer of pending.values()) answer(null)
      pending.clear()
    })
    worker = w
  }
  if (idle) clearTimeout(idle)
  const current = worker
  idle = setTimeout(() => void current.terminate(), IDLE_CLOSE_MS)
  return current
}

/** Stop any scan: terminating the worker ends its OCR too, and answers its scans `cancelled`. */
function cancel(): void {
  generation++
  if (idle) clearTimeout(idle)
  void worker?.terminate()
}

function scanDir(): string {
  return join(app.getPath('userData'), 'currency-scan')
}

/** `background`: an auto rescan, which reads only captures a saved fingerprint matches. */
async function scan(background: boolean): Promise<CurrencyScanResult> {
  const mine = generation
  // A Scan press starts the worker alongside the capture; a background rescan only after it.
  if (!background) useWorker()
  const { images, minimized } = await captureEqImages()
  if (mine !== generation) return { ok: false, error: 'cancelled' }
  if (minimized) return { ok: false, error: 'eq-minimized' }
  if (images.length === 0) return { ok: false, error: 'eq-window-not-found' }
  const w = useWorker()
  const id = nextId++
  const reply = await new Promise<ScanReply | null>((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ id, captures: images, dir: scanDir(), background } satisfies ScanRequest)
  })
  if (reply === null) return { ok: false, error: 'cancelled' }
  for (const line of reply.log) logInfo(`[currency-scan] ${line}`)
  if (!reply.ok) throw new Error(reply.message)
  const o = reply.outcome
  if (o.kind === 'not-currency-window') return { ok: false, error: 'not-currency-window' }
  const zeroed = currencyVocabulary().filter((n) => !(n in o.counts))
  // A complete read is saved at once; an unreadable row would be stated as 0, so otherwise nothing
  // is saved and the user rescans.
  if (o.complete) state(o.counts)
  return { ok: true, counts: o.counts, unmatched: o.unmatched, zeroed, saved: o.complete }
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
  if (background || pending.size > 0) return
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
  ipcMain.handle(IPC.warmCurrencyScan, () => {
    useWorker()
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

// currencyScanWorker.ts — the currency scan's own thread. Main posts raw captures and gets back a
// merged read; decoding, the pixel search, file writes and OCR orchestration all happen here, so a
// scan (or a background rescan every 45 s) never stalls the main process — window drags included.
// The OCR workers live inside this thread; terminating it (Stop) ends them too.

import { parentPort, workerData } from 'node:worker_threads'
import { createCurrencyReader, type CurrencyReader } from './currencyScan'
import { runScan, type RawCapture, type ScanOutcome } from './currencyScan/scanJob'

export interface ScanWorkerData {
  langDir: string
}

export interface ScanRequest {
  id: number
  captures: RawCapture[]
  dir: string
  background: boolean
}

export type ScanReply =
  | { id: number; ok: true; outcome: ScanOutcome; log: string[] }
  | { id: number; ok: false; message: string; log: string[] }

const { langDir } = workerData as ScanWorkerData
// Started at once: spawning this worker IS the warm-up.
const reader: Promise<CurrencyReader> = createCurrencyReader(langDir)

parentPort?.on('message', (req: ScanRequest) => {
  const log: string[] = []
  void reader
    .then((r) => runScan(r, req, (line) => log.push(line)))
    .then(
      (outcome) => parentPort?.postMessage({ id: req.id, ok: true, outcome, log } satisfies ScanReply),
      (e: unknown) => parentPort?.postMessage({ id: req.id, ok: false, message: String(e), log } satisfies ScanReply)
    )
})

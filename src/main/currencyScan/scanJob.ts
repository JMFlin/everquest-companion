// scanJob.ts — one scan, from raw captures to a merged read, run inside the scan worker
// (currencyScanWorker.ts) so none of it blocks the main process: decoding and pixel conversion,
// the fingerprint search, the capture files kept for inspection, and the OCR orchestration.
// Node only, no Electron, so a test can drive it with files.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { showsCurrencyWindow, type CurrencyReader, type CurrencyScan, type Fingerprint } from './index'
import { mergeReads } from './merge'
import { decodePng, encodePng, type Rgba } from './png'

/** A capture as main hands it over: PrintWindow's PNG, or a desktopCapturer thumbnail's raw BGRA. */
export type RawCapture = { png: Uint8Array } | { bgra: Uint8Array; width: number; height: number }

export type ScanOutcome =
  | { kind: 'not-currency-window' }
  | { kind: 'read'; counts: Record<string, number>; unmatched: string[]; complete: boolean }

/** One fingerprint per UI size (laptop, monitor, ...) so switching screens stays fast. */
const MAX_FINGERPRINTS = 4

export function toRgba(c: RawCapture): Rgba {
  if ('png' in c) return decodePng(Buffer.from(c.png))
  const data = new Uint8Array(c.width * c.height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = c.bgra[i + 2]
    data[i + 1] = c.bgra[i + 1]
    data[i + 2] = c.bgra[i]
    data[i + 3] = 255
  }
  return { width: c.width, height: c.height, data }
}

/**
 * `background`: an auto rescan, which reads only captures a saved fingerprint matches. `log`
 * receives one line per capture; main writes them to its log (a worker has no Electron logger).
 */
export async function runScan(
  reader: CurrencyReader,
  { captures, dir, background }: { captures: readonly RawCapture[]; dir: string; background: boolean },
  log: (line: string) => void
): Promise<ScanOutcome> {
  mkdirSync(dir, { recursive: true })
  const fingerprints = loadFingerprints(dir)
  const all = captures.map(toRgba)
  const images = background ? all.filter((img) => showsCurrencyWindow(img, fingerprints)) : all
  if (images.length === 0) return { kind: 'not-currency-window' }
  // The last scan's captures stay on disk (overwritten each scan) so a misread can be inspected.
  images.forEach((img, i) => writeFileSync(join(dir, `capture-${i}.png`), encodePng(img)))
  const reads: Extract<CurrencyScan, { counts: unknown }>[] = []
  for (const [i, img] of images.entries()) {
    const r = await reader.read(img, fingerprints)
    if ('error' in r) {
      log(`capture-${i}: ${r.error}`)
      continue
    }
    log(`capture-${i}: ${Object.keys(r.counts).length} rows read${r.unmatched.length ? `, unreadable: ${r.unmatched.join(' / ')}` : ''}`)
    reads.push(r)
    // Each capture is another read of one window: stop once the reads so far are complete.
    if (mergeReads(reads).complete) break
  }
  if (reads.length === 0) return { kind: 'not-currency-window' }
  saveFingerprint(dir, reads[0].fingerprint)
  const merged = mergeReads(reads)
  log(`${merged.complete ? 'complete' : 'incomplete'} from ${reads.length} capture(s)`)
  return { kind: 'read', counts: merged.counts, unmatched: merged.unmatched, complete: merged.complete }
}

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

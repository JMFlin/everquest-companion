// The scan worker (src/main/currencyScanWorker.ts) and its job (currencyScan/scanJob.ts): a scan
// runs off the main thread end to end, from raw captures to a merged read.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createCurrencyReader, type CurrencyReader } from '../src/main/currencyScan/index'
import { runScan, toRgba } from '../src/main/currencyScan/scanJob'
import { decodePng } from '../src/main/currencyScan/png'

const LANG_DIR = join(import.meta.dirname, '..', 'resources', 'ocr')
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'currency-window.png'))
const noLog = (): void => undefined

let reader: CurrencyReader
before(async () => {
  reader = await createCurrencyReader(LANG_DIR)
})
after(async () => {
  await reader.close()
})

test('a desktopCapturer BGRA thumbnail converts to the same pixels as its PNG', () => {
  const img = decodePng(FIXTURE)
  const bgra = new Uint8Array(img.data.length)
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = img.data[i + 2]
    bgra[i + 1] = img.data[i + 1]
    bgra[i + 2] = img.data[i]
    bgra[i + 3] = 255
  }
  const back = toRgba({ bgra, width: img.width, height: img.height })
  assert.deepEqual(back.data.filter((_, i) => i % 4 !== 3), img.data.filter((_, i) => i % 4 !== 3))
})

test('a scan reads, keeps its capture and saves a fingerprint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-scan-'))
  const outcome = await runScan(reader, { captures: [{ png: FIXTURE }], dir, background: false }, noLog)
  assert.equal(outcome.kind, 'read')
  assert.ok(outcome.kind === 'read' && outcome.complete && Object.keys(outcome.counts).length === 24)
  const files = readdirSync(dir)
  assert.ok(files.includes('capture-0.png'))
  assert.ok(files.some((f) => /^fp-\d+\.png$/.test(f)))
})

test('a background rescan with no saved fingerprint reads nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-scan-'))
  const outcome = await runScan(reader, { captures: [{ png: FIXTURE }], dir, background: true }, noLog)
  assert.deepEqual(outcome, { kind: 'not-currency-window' })
})

test('the worker thread answers a scan request with a complete read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-scan-'))
  const w = new Worker(new URL('../src/main/currencyScanWorker.ts', import.meta.url), {
    execArgv: ['--import', 'tsx'],
    workerData: { langDir: LANG_DIR }
  })
  try {
    const reply = await new Promise<{ ok: boolean; outcome?: { kind: string; complete?: boolean } }>((resolve, reject) => {
      w.once('message', resolve)
      w.once('error', reject)
      w.postMessage({ id: 1, captures: [{ png: FIXTURE }], dir, background: false })
    })
    assert.equal(reply.ok, true)
    assert.equal(reply.outcome?.kind, 'read')
    assert.equal(reply.outcome?.complete, true)
  } finally {
    await w.terminate()
  }
})

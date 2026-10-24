// The currencies-window reader, end to end on a real screenshot: real tesseract, bundled
// traineddata, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCurrencyWindow } from '../src/main/currencyScan/index'
import { decodePng, encodePng } from '../src/main/currencyScan/png'
import { locateFingerprint } from '../src/main/currencyScan/locate'
import { crop } from '../src/main/currencyScan/raster'
import { currencyVocabulary, matchCurrencyName } from '../src/main/currencyScan/vocabulary'
import { MOTES } from '../src/shared/planner/motes'

const LANG_DIR = join(import.meta.dirname, '..', 'resources', 'ocr')
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'currency-window.png'))

const EXPECTED: Record<string, number> = {
  'Wind Rune Azia': 7,
  'Wind Rune Beza': 7,
  'Wind Rune Caza': 7,
  'Wind Rune Dena': 3,
  'Wind Rune Ena': 8,
  'Wind Rune Fana': 6,
  'Wind Rune Geza': 5,
  'Wind Rune Heda': 5,
  'Wind Rune Izah': 4,
  'Wind Rune Jaka': 11,
  'Wind Rune Kala': 7,
  'Wind Rune Lena': 7,
  'Wind Rune Meda': 5,
  'Wind Rune Neza': 7,
  'Wind Rune Ozah': 6,
  'Mote of Grand Potential': 1,
  'Mote of Greater Potential': 12,
  'Mote of Infinite Potential': 1,
  'Mote of Infinitesimal Potential': 21,
  'Mote of Lesser Potential': 1,
  'Mote of Major Potential': 6,
  'Mote of Minor Potential': 29,
  'Mote of Potential': 10,
  'Mote of Superior Potential': 1
}

function assertReads(r: Awaited<ReturnType<typeof readCurrencyWindow>>, expected: Record<string, number>): void {
  assert.ok(!('error' in r), 'read')
  assert.deepEqual({ counts: r.counts, unmatched: r.unmatched }, { counts: expected, unmatched: [] })
}

test('expected mote names are MOTES names', () => {
  const names = new Set(MOTES.map((m) => m.name))
  for (const key of Object.keys(EXPECTED)) if (key.startsWith('Mote')) assert.ok(names.has(key), key)
})

function blackCanvas(width: number, height: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(width * height * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return { width, height, data }
}

test('reads every row of the currencies window', async () => {
  assertReads(await readCurrencyWindow(FIXTURE, LANG_DIR), EXPECTED)
})

// A live in-game capture (owner, 2026-10-24) with "Motes of Major Potential" selected: the
// selected row sits on a light band that one global threshold cannot read alongside the rest.
test('reads a live capture with a selected (highlighted) row', async () => {
  const live = readFileSync(join(import.meta.dirname, 'fixtures', 'currency-live-highlight.png'))
  const expected = { ...EXPECTED, 'Mote of Greater Potential': 13 }
  assertReads(await readCurrencyWindow(live, LANG_DIR), expected)
})

test('finds the window at an offset inside a larger capture', async () => {
  const win = decodePng(FIXTURE)
  const canvas = blackCanvas(win.width + 400, win.height + 300)
  const [ox, oy] = [230, 170]
  for (let y = 0; y < win.height; y++) {
    canvas.data.set(win.data.subarray(y * win.width * 4, (y + 1) * win.width * 4), ((oy + y) * canvas.width + ox) * 4)
  }
  assertReads(await readCurrencyWindow(encodePng(canvas), LANG_DIR), EXPECTED)
})

test('a remembered fingerprint finds the window by pixels and reads it the same', async () => {
  const first = await readCurrencyWindow(FIXTURE, LANG_DIR)
  assert.ok(!('error' in first))
  const win = decodePng(FIXTURE)
  const canvas = blackCanvas(win.width + 900, win.height + 500)
  const [ox, oy] = [610, 330]
  for (let y = 0; y < win.height; y++) {
    canvas.data.set(win.data.subarray(y * win.width * 4, (y + 1) * win.width * 4), ((oy + y) * canvas.width + ox) * 4)
  }
  const inWindow = locateFingerprint(win, first.fingerprint)
  assert.ok(inWindow)
  assert.deepEqual(locateFingerprint(canvas, first.fingerprint), { x: inWindow.x + ox, y: inWindow.y + oy })
  assertReads(await readCurrencyWindow(encodePng(canvas), LANG_DIR, first.fingerprint), EXPECTED)
})

test('a fingerprint that is not in the capture is no match', () => {
  const win = decodePng(FIXTURE)
  assert.equal(locateFingerprint(blackCanvas(800, 600), crop(win, { x: 40, y: 0, width: 300, height: 24 })), null)
})

test('an image without the header is not a currencies window', async () => {
  assert.deepEqual(await readCurrencyWindow(encodePng(blackCanvas(320, 240)), LANG_DIR), {
    error: 'not-currency-window'
  })
})

test('png codec round-trips the fixture pixels', () => {
  const img = decodePng(FIXTURE)
  assert.deepEqual(decodePng(encodePng(img)), img)
})

test('column-divider and period junk around a live-capture name still matches', () => {
  const vocab = currencyVocabulary()
  assert.equal(matchCurrencyName('® Beza Wind Runes. |', vocab), 'Wind Rune Beza')
  assert.equal(matchCurrencyName('@ Jaka Wind Runes |', vocab), 'Wind Rune Jaka')
})

// The currencies-window reader, end to end on a real screenshot: real tesseract, bundled
// traineddata, no network.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCurrencyReader, findHeader, showsCurrencyWindow, type CurrencyReader } from '../src/main/currencyScan/index'
import { decodePng, encodePng } from '../src/main/currencyScan/png'
import { locateFingerprint } from '../src/main/currencyScan/locate'
import { crop, resize } from '../src/main/currencyScan/raster'
import { currencyVocabulary, isUntrackedCurrency, matchCurrencyName } from '../src/main/currencyScan/vocabulary'
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

function assertReads(r: Awaited<ReturnType<CurrencyReader['read']>>, expected: Record<string, number>): void {
  assert.ok(!('error' in r), 'read')
  assert.deepEqual({ counts: r.counts, unmatched: r.unmatched }, { counts: expected, unmatched: [] })
}

// One reader (its OCR workers) for the whole file, as the app keeps one warm between scans.
let reader: CurrencyReader
before(async () => {
  reader = await createCurrencyReader(LANG_DIR)
})
after(async () => {
  await reader.close()
})

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
  assertReads(await reader.read(FIXTURE), EXPECTED)
})

// A live in-game capture (owner, 2026-10-24) with "Motes of Major Potential" selected: the
// selected row sits on a light band that one global threshold cannot read alongside the rest.
test('reads a live capture with a selected (highlighted) row', async () => {
  const live = readFileSync(join(import.meta.dirname, 'fixtures', 'currency-live-highlight.png'))
  const expected = { ...EXPECTED, 'Mote of Greater Potential': 13 }
  assertReads(await reader.read(live), expected)
})

// PrintWindow capture of the game behind other windows (owner, 2026-10-24): a smaller UI (9 px
// header text) with "Ozah Wind Runes" selected. Small text misread "Izah" and dropped a "1" of "11".
test('reads a background PrintWindow capture of a small UI', async () => {
  const pw = readFileSync(join(import.meta.dirname, 'fixtures', 'currency-printwindow.png'))
  assertReads(await reader.read(pw), { ...EXPECTED, 'Mote of Greater Potential': 13 })
})

// Chromium window capture at 11 px text (owner, 2026-10-24) with "Ozah Wind Runes" selected: OCR
// read its 6 as 6 and as 5, so the glyph fallback (glyphs.ts) settles it from the capture's own 6s.
test('settles a split digit on the selected row from the digits of the same capture', async () => {
  const png = readFileSync(join(import.meta.dirname, 'fixtures', 'currency-chromium-11px.png'))
  assertReads(await reader.read(png), {
    ...EXPECTED,
    'Mote of Greater Potential': 13,
    'Mote of Infinitesimal Potential': 23
  })
})

test('finds the window at an offset inside a larger capture', async () => {
  const win = decodePng(FIXTURE)
  const canvas = blackCanvas(win.width + 400, win.height + 300)
  const [ox, oy] = [230, 170]
  for (let y = 0; y < win.height; y++) {
    canvas.data.set(win.data.subarray(y * win.width * 4, (y + 1) * win.width * 4), ((oy + y) * canvas.width + ox) * 4)
  }
  assertReads(await reader.read(encodePng(canvas)), EXPECTED)
})

test('a remembered fingerprint finds the window by pixels and reads it the same', async () => {
  const first = await reader.read(FIXTURE)
  assert.ok(!('error' in first))
  const win = decodePng(FIXTURE)
  const canvas = blackCanvas(win.width + 900, win.height + 500)
  const [ox, oy] = [610, 330]
  for (let y = 0; y < win.height; y++) {
    canvas.data.set(win.data.subarray(y * win.width * 4, (y + 1) * win.width * 4), ((oy + y) * canvas.width + ox) * 4)
  }
  const inWindow = locateFingerprint(win, first.fingerprint.strip)
  assert.ok(inWindow)
  assert.deepEqual(locateFingerprint(canvas, first.fingerprint.strip), { x: inWindow.x + ox, y: inWindow.y + oy })
  assertReads(await reader.read(encodePng(canvas), [first.fingerprint]), EXPECTED)
})

test('the background check sees the window by its saved fingerprint, and nothing without one', async () => {
  const first = await reader.read(FIXTURE)
  assert.ok(!('error' in first))
  assert.equal(showsCurrencyWindow(decodePng(FIXTURE), [first.fingerprint]), true)
  assert.equal(showsCurrencyWindow(blackCanvas(800, 600), [first.fingerprint]), false)
  assert.equal(showsCurrencyWindow(decodePng(FIXTURE), []), false)
})

test('a fingerprint that is not in the capture is no match', () => {
  const win = decodePng(FIXTURE)
  assert.equal(locateFingerprint(blackCanvas(800, 600), crop(win, { x: 40, y: 0, width: 300, height: 24 })), null)
})

test('an image without the header is not a currencies window', async () => {
  assert.deepEqual(await reader.read(encodePng(blackCanvas(320, 240))), {
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

test('currencies the window lists but the app does not track are recognised, icon junk and all', () => {
  for (const row of ['ESExpedient Delivery Vouchers', '®mExpedient Delivery Vouchers', '@Tokens of Reclamation', '@ Tokens of Reclamation']) {
    assert.ok(isUntrackedCurrency(row), row)
  }
  assert.ok(!isUntrackedCurrency('@Motes of Greater Potential'))
  assert.ok(!isUntrackedCurrency('® Beza Wind Runes. |'))
})

test('the header words in running text are not a header (they once matched this app message)', () => {
  const word = (text: string, x0: number, x1: number) => ({ text, bbox: { x0, y0: 3, x1, y1: 19 } })
  // Measured off that capture: "(Name / Expansion / Quantity)." with ~17 px between labels.
  assert.equal(findHeader([word('(Name', 4, 55), word('Expansion', 72, 149), word('Quantity).', 166, 241)]), null)
  // The real window's columns are far apart.
  assert.ok(findHeader([word('Name', 57, 95), word('Expansion', 275, 345), word('Quantity', 465, 522)]))
})

// ---- other screens / UI scales -------------------------------------------------------------
// The goldens are 9-12 px text. A bigger screen or UI scale draws the same window larger; these
// rescale the goldens (bilinear up, area down: softer than a real large UI, so harsher).

const LIVE_EXPECTED = { ...EXPECTED, 'Mote of Greater Potential': 13 }
const fixture = (name: string): Buffer => readFileSync(join(import.meta.dirname, 'fixtures', `${name}.png`))
const rescaled = (name: string, k: number): Buffer => encodePng(resize(decodePng(fixture(name)), k))

for (const [name, k, expected] of [
  ['currency-window', 1.5, EXPECTED],
  ['currency-window', 2, EXPECTED],
  ['currency-live-highlight', 1.75, LIVE_EXPECTED]
] as const) {
  test(`reads every row of ${name} drawn ${k}x larger`, async () => {
    assertReads(await reader.read(rescaled(name, k)), expected)
  })
}

// Selected rows at these sizes can come out unreadable (Confirm then stays off); what may NEVER
// happen at any size is a wrong number.
for (const [name, k, expected] of [
  ['currency-live-highlight', 0.8, LIVE_EXPECTED],
  ['currency-printwindow', 1.5, LIVE_EXPECTED],
  ['currency-printwindow', 2.5, LIVE_EXPECTED]
] as const) {
  test(`every number read from ${name} drawn ${k}x is right`, async () => {
    const r = await reader.read(rescaled(name, k))
    assert.ok(!('error' in r), 'read')
    for (const [item, n] of Object.entries(r.counts)) assert.equal(n, expected[item], item)
    assert.ok(Object.keys(r.counts).length + r.unmatched.length >= 23, 'rows found')
    assert.ok(r.unmatched.length <= 1, `unreadable: ${r.unmatched.join(', ')}`)
  })
}

test('a fingerprint saved on one screen finds the window drawn 1.5x larger', async () => {
  const first = await reader.read(FIXTURE)
  assert.ok(!('error' in first))
  const big = decodePng(rescaled('currency-window', 1.5))
  const canvas = blackCanvas(big.width + 700, big.height + 400)
  for (let y = 0; y < big.height; y++) {
    canvas.data.set(big.data.subarray(y * big.width * 4, (y + 1) * big.width * 4), ((260 + y) * canvas.width + 410) * 4)
  }
  assert.equal(locateFingerprint(canvas, first.fingerprint.strip), null, 'as drawn it does not match')
  assertReads(await reader.read(encodePng(canvas), [first.fingerprint]), EXPECTED)
})

// Reads the EverQuest Legends "currencies" inventory window out of a screenshot.
//
// Pipeline: find the `Name | Expansion | Quantity` header (by a remembered pixel fingerprint, else
// by OCR over the whole capture; absent → not-currency-window), OCR the name column, read every
// quantity cell under several image settings in stacked batches, then resolve names against the
// closed currency vocabulary.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createWorker, OEM, PSM, type Line, type Word, type Worker } from 'tesseract.js'
import { decodePng, encodePng, type Rgba } from './png'
import { binarizeForOcr, flattenRows, crop, type Rect } from './raster'
import { currencyVocabulary, matchCurrencyName } from './vocabulary'
import { locateFingerprint } from './locate'

/**
 * The header strip as an earlier capture drew it, plus the three header labels' boxes relative to
 * the strip's top-left. A pixel match of the strip restores the whole column layout without OCR.
 */
export interface Fingerprint {
  readonly strip: Rgba
  readonly header: Header
}

export type CurrencyScan =
  | { counts: Record<string, number>; unmatched: string[]; fingerprint: Fingerprint }
  | { error: 'not-currency-window' }

export interface CurrencyReader {
  read(png: Buffer, fingerprint?: Fingerprint): Promise<CurrencyScan>
  close(): Promise<void>
}

/** The first two read the name passes side by side; all of them share the quantity cells. */
const WORKERS = 4
type Workers = readonly Worker[]

/**
 * Every quantity cell is read under several upscale/threshold settings; the number every non-empty
 * read agrees on wins, any disagreement leaves the row unmatched. One setting cannot read both plain
 * rows and the selected row's light band: tiny "11"s collapse to "1" at the edges. The third
 * setting only runs on cells the first two did not settle.
 */
const DIGIT_VOTES: readonly { scale: number; threshold: number; flatten: boolean }[] = [
  { scale: 3, threshold: 105, flatten: false },
  { scale: 4, threshold: 55, flatten: true },
  { scale: 3, threshold: 70, flatten: true }
]

interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface Header {
  readonly name: Box
  readonly expansion: Box
  readonly quantity: Box
}

/** One OCR'd text line in full-image coordinates. */
interface TextLine {
  readonly text: string
  readonly yMid: number
}

/**
 * WORKERS tesseract workers (each its own worker_thread) so independent passes run side by side.
 * `langDir` holds `eng.traineddata` (see `findOcrLangDir`). Close when done.
 */
export async function createCurrencyReader(langDir: string): Promise<CurrencyReader> {
  const options = {
    // Read-only cache read of `<langDir>/eng.traineddata`: no download, no cache writes.
    // langPath is set too so a miss can never fall back to the default CDN URL.
    cachePath: langDir,
    cacheMethod: 'readOnly',
    langPath: langDir,
    gzip: false
  }
  const workers: Workers = await Promise.all(
    Array.from({ length: WORKERS }, () => createWorker('eng', OEM.LSTM_ONLY, options))
  )
  return {
    read: (png, fingerprint) => read(workers, decodePng(png), fingerprint),
    close: async () => {
      await Promise.all(workers.map((w) => w.terminate()))
    }
  }
}

async function read(workers: Workers, img: Rgba, fingerprint?: Fingerprint): Promise<CurrencyScan> {
  const at = fingerprint && locateFingerprint(img, fingerprint.strip)
  if (fingerprint && at) {
    const r = await readRows(workers, img, moved(fingerprint.header, at.x, at.y))
    if (Object.keys(r.counts).length > 0) return r
  }
  await workers[0].setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' })
  const header = findHeader((await workers[0].recognize(encodePng(img))).data.words)
  return header === null ? { error: 'not-currency-window' } : readRows(workers, img, header)
}

function moved(h: Header, dx: number, dy: number): Header {
  const box = (b: Box): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy })
  return { name: box(h.name), expansion: box(h.expansion), quantity: box(h.quantity) }
}

async function readRows(
  workers: Workers,
  img: Rgba,
  header: Header
): Promise<{ counts: Record<string, number>; unmatched: string[]; fingerprint: Fingerprint }> {
  const textHeight = header.name.y1 - header.name.y0
  const names = await readNames(workers, img, header)
  const qtyX = (header.expansion.x1 + header.quantity.x0) / 2
  const qtyWidth = header.quantity.x1 + textHeight - qtyX
  const cells = names.map((n) =>
    crop(img, { x: qtyX, y: n.yMid - 0.75 * textHeight, width: qtyWidth, height: 1.5 * textHeight })
  )
  const qtys = await readQuantities(workers, cells)
  const rows: Row[] = names.map((n, i) => ({ name: n.text, qty: qtys[i] }))

  const strip: Rect = {
    x: header.name.x0 - 4,
    y: header.name.y0 - 3,
    width: header.quantity.x1 - header.name.x0 + 8,
    height: textHeight + 6
  }
  return { ...resolveRows(rows), fingerprint: { strip: crop(img, strip), header: moved(header, -strip.x, -strip.y) } }
}

/**
 * Plain and row-flattened name passes, one per worker: each misses rows the other reads (the
 * selected row's band; the last row of a short window). Per row height, a line naming an item wins.
 */
async function readNames(workers: Workers, img: Rgba, header: Header): Promise<TextLine[]> {
  const textHeight = header.name.y1 - header.name.y0
  const top = header.quantity.y1 + 1
  const x = header.name.x0 - 2 * textHeight
  const rect: Rect = { x, y: top, width: header.expansion.x0 - 2 - x, height: img.height - top }
  const params = { tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '' }
  await Promise.all(workers.map((w) => w.setParameters(params)))
  const [raw, flat] = await Promise.all([
    recognizeCrop(workers[0], crop(img, rect)),
    recognizeCrop(workers[1], flattenRows(crop(img, rect)))
  ])
  return rowBlock(mergeRows([...textLines(raw, rect, 1), ...textLines(flat, rect, 1)], textHeight), textHeight)
}

/**
 * The agreed number per cell (null = unreadable), voting as DIGIT_VOTES describes. Each cell is
 * read alone (single-line mode: stacking cells into one image loses the "1"s of "11"), and the
 * cells are shared out across every worker.
 */
async function readQuantities(workers: Workers, cells: readonly Rgba[]): Promise<(string | null)[]> {
  const params = { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789' }
  await Promise.all(workers.map((w) => w.setParameters(params)))
  const out: (string | null)[] = []
  let next = 0
  await Promise.all(
    workers.map(async (w) => {
      for (let i = next++; i < cells.length; i = next++) out[i] = await readCell(w, cells[i])
    })
  )
  return out
}

async function readCell(worker: Worker, cell: Rgba): Promise<string | null> {
  const reads: string[] = []
  for (const v of DIGIT_VOTES) {
    const img = binarizeForOcr(v.flatten ? flattenRows(cell) : cell, v.scale, v.threshold)
    reads.push((await recognizeCrop(worker, img)).map((l) => l.text.trim()).join(''))
    // Two settings already agreeing settles the cell; the third only matters on a split.
    if (reads.length === 2 && reads[0] !== '' && reads[0] === reads[1]) break
  }
  return agreed(reads)
}

async function recognizeCrop(worker: Worker, img: Rgba): Promise<Line[]> {
  return (await worker.recognize(encodePng(img))).data.lines
}

/** `Name`, `Expansion`, `Quantity` left to right at one height. */
function findHeader(words: readonly Word[]): Header | null {
  const labelled = (label: string): Box[] =>
    words.filter((w) => w.text.replace(/[^A-Za-z]/g, '').toLowerCase() === label).map((w) => w.bbox)
  for (const name of labelled('name')) {
    const level = (b: Box): boolean => Math.abs(b.y0 + b.y1 - name.y0 - name.y1) / 2 < name.y1 - name.y0
    const expansion = labelled('expansion').find((b) => level(b) && b.x0 > name.x1)
    const quantity = labelled('quantity').find((b) => level(b) && expansion !== undefined && b.x0 > expansion.x1)
    if (expansion && quantity) return { name, expansion, quantity }
  }
  return null
}

/** Non-empty lines mapped back from a crop (scaled by `scale`) to full-image y. */
function textLines(lines: readonly Line[], rect: Rect, scale: number): TextLine[] {
  return lines
    .map((l) => ({ text: l.text.trim(), yMid: rect.y + (l.bbox.y0 + l.bbox.y1) / 2 / scale }))
    .filter((l) => l.text !== '')
}

/** The contiguous run of rows under the header; a gap wider than ~2.5 rows ends the window. */
function rowBlock(lines: readonly TextLine[], textHeight: number): TextLine[] {
  const block: TextLine[] = []
  for (const line of [...lines].sort((a, b) => a.yMid - b.yMid)) {
    const prev = block.at(-1)
    if (prev && line.yMid - prev.yMid > 2.5 * textHeight) break
    block.push(line)
  }
  return block
}

interface Row {
  readonly name: string
  readonly qty: string | null
}

/**
 * Lines within ~half a row of each other are one row; prefer a line that names an item. A line
 * naming an item another row already names is the second pass's ghost of it, never a new row.
 */
function mergeRows(lines: readonly TextLine[], textHeight: number): TextLine[] {
  const vocab = currencyVocabulary()
  const rows: TextLine[] = []
  for (const line of [...lines].sort((a, b) => a.yMid - b.yMid)) {
    const name = matchCurrencyName(line.text, vocab)
    if (name !== null && rows.some((r) => matchCurrencyName(r.text, vocab) === name)) continue
    const i = rows.findIndex((r) => Math.abs(r.yMid - line.yMid) < textHeight * 0.6)
    if (i === -1) rows.push(line)
    else if (matchCurrencyName(rows[i].text, vocab) === null && matchCurrencyName(line.text, vocab) !== null) {
      rows[i] = line
    }
  }
  return rows
}

/** The number every non-empty read agrees on; null when none read or two disagree. */
function agreed(reads: readonly string[]): string | null {
  const numbers = new Set(reads.filter((r) => r !== ''))
  const [only] = numbers
  return numbers.size === 1 && /^\d+$/.test(only) ? only : null
}

/** Every row lands in `counts` or, verbatim, in `unmatched`. */
function resolveRows(rows: readonly Row[]): { counts: Record<string, number>; unmatched: string[] } {
  const vocab = currencyVocabulary()
  const counts: Record<string, number> = {}
  const unmatched: string[] = []
  for (const row of rows) {
    const name = matchCurrencyName(row.name, vocab)
    if (name !== null && row.qty !== null && !(name in counts)) counts[name] = Number(row.qty)
    else unmatched.push(`${row.name} | ${row.qty ?? '?'}`)
  }
  return { counts, unmatched }
}

/** Probe order for the bundled `resources/ocr` dir; mirrors `bundledImageRoots`. */
export function findOcrLangDir(appPath: string, resourcesPath: string, cwd: string): string | null {
  const roots = [
    join(appPath, 'resources', 'ocr'),
    join(`${appPath}.unpacked`, 'resources', 'ocr'),
    ...(resourcesPath === '' ? [] : [join(resourcesPath, 'ocr')]),
    join(cwd, 'resources', 'ocr')
  ]
  return roots.find((r) => existsSync(join(r, 'eng.traineddata'))) ?? null
}

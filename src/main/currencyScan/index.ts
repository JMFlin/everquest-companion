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
import { binarizeForOcr, flattenRows, crop, resize, upscale, type Rect } from './raster'
import { currencyVocabulary, isUntrackedCurrency, matchCurrencyName } from './vocabulary'
import { locateIn, MATCH, prepare } from './locate'
import { learnDigits, readByGlyphs } from './glyphs'

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
  /**
   * A PNG, or already-decoded pixels (the scan worker's raw captures).
   * `fingerprints`: the saved ones, newest first (one per UI size the user has scanned at).
   */
  read(image: Buffer | Rgba, fingerprints?: readonly Fingerprint[]): Promise<CurrencyScan>
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
  { scale: 3, threshold: 70, flatten: true },
  { scale: 5, threshold: 90, flatten: false },
  { scale: 4, threshold: 80, flatten: true }
]

/** The largest row pitch DIGIT_VOTES' upscales were measured at (golden fixtures: 14.8-18.9 px). */
const DIGIT_PITCH = 19

/** Ink above this (after row flattening) is part of a glyph when counting digits. */
const GLYPH_INK = 60

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
    read: (image, fingerprints = []) => read(workers, Buffer.isBuffer(image) ? decodePng(image) : image, fingerprints),
    close: async () => {
      await Promise.all(workers.map((w) => w.terminate()))
    }
  }
}

async function read(workers: Workers, img: Rgba, fingerprints: readonly Fingerprint[]): Promise<CurrencyScan> {
  const located = locateHeader(img, fingerprints)
  if (located) {
    const header = located
    const r = await readWindow(workers, img, header)
    if (Object.keys(r.counts).length > 0) return { ...r, fingerprint: fingerprintOf(img, header) }
  }
  await workers[0].setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' })
  const header = findHeader((await recognizeCrop(workers[0], img)).flatMap((line) => line.words))
  if (header === null) return { error: 'not-currency-window' }
  const r = await readWindow(workers, img, header)
  // A window that lists nothing readable is not evidence of anything; never offer it as a result.
  return Object.keys(r.counts).length === 0 ? { error: 'not-currency-window' } : { ...r, fingerprint: fingerprintOf(img, header) }
}

/** OCR misreads small UI text ("Izah" as "z3h", "11" as "1"); below this the window is enlarged. */
const MIN_TEXT_HEIGHT = 14

/**
 * The rows under `header`. A small UI (low text height) is read from the window alone, enlarged
 * so its text is MIN_TEXT_HEIGHT tall; the fingerprint is always cut from the capture as drawn.
 */
async function readWindow(
  workers: Workers,
  img: Rgba,
  header: Header
): Promise<{ counts: Record<string, number>; unmatched: string[] }> {
  const textHeight = header.name.y1 - header.name.y0
  const names = textHeight >= MIN_TEXT_HEIGHT ? await readNames(workers, img, header) : await readNamesEnlarged(workers, img, header)
  // Quantities are read from the capture as drawn: DIGIT_VOTES upscale each cell themselves.
  const qtyX = (header.expansion.x1 + header.quantity.x0) / 2
  const qtyWidth = header.quantity.x1 + textHeight - qtyX
  // Row pitch, not a header box, sizes the digit cells: OCR boxes can merge (a 2x UI once read
  // all three labels as one 29 px box), the median gap over ~24 rows does not.
  const pitch = rowPitch(names) ?? 1.57 * textHeight
  const cellHeight = Math.min(1.5 * textHeight, 0.95 * pitch)
  const cells = names.map((n) =>
    crop(img, { x: qtyX, y: n.yMid - cellHeight / 2, width: qtyWidth, height: cellHeight })
  )
  const qtys = await readQuantities(workers, cells, pitch)
  return resolveRows(names.map((n, i) => ({ name: n.text, qty: qtys[i] })))
}

/** A small UI's names, read from the window alone enlarged to MIN_TEXT_HEIGHT; rows in capture y. */
async function readNamesEnlarged(workers: Workers, img: Rgba, header: Header): Promise<TextLine[]> {
  const textHeight = header.name.y1 - header.name.y0
  const k = MIN_TEXT_HEIGHT / textHeight
  const win: Rect = {
    x: Math.max(0, header.name.x0 - 4 * textHeight),
    y: Math.max(0, header.name.y0 - textHeight),
    width: header.quantity.x1 - header.name.x0 + 8 * textHeight,
    height: 70 * textHeight
  }
  const local = moved(header, -win.x, -win.y)
  const box = (b: Box): Box => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k })
  const names = await readNames(workers, upscale(crop(img, win), k), {
    name: box(local.name),
    expansion: box(local.expansion),
    quantity: box(local.quantity)
  })
  return names.map((n) => ({ text: n.text, yMid: n.yMid / k + win.y }))
}

function fingerprintOf(img: Rgba, header: Header): Fingerprint {
  const textHeight = header.name.y1 - header.name.y0
  const strip: Rect = {
    x: header.name.x0 - 4,
    y: header.name.y0 - 3,
    width: header.quantity.x1 - header.name.x0 + 8,
    height: textHeight + 6
  }
  return { strip: crop(img, strip), header: moved(header, -strip.x, -strip.y) }
}

/** Sizes tried when no saved fingerprint matches as drawn: another screen or UI scale. */
const FINGERPRINT_SCALES = [0.6, 0.7, 0.8, 0.9, 1.15, 1.3, 1.5, 1.75, 2, 2.5]
/** A resized fingerprint is softer than the capture it is compared with; its bar is lower. */
const RESIZED_MATCH = 0.75

/**
 * The header by pixels: each saved fingerprint as drawn, then the newest one resized. A wrong
 * match is harmless (no rows read → the full OCR search runs), a missed one only costs time.
 */
function locateHeader(img: Rgba, fingerprints: readonly Fingerprint[]): Header | null {
  if (fingerprints.length === 0) return null
  const capture = prepare(img)
  for (const fp of fingerprints) {
    const at = locateIn(capture, fp.strip, MATCH)
    if (at) return moved(fp.header, at.x, at.y)
  }
  const [latest] = fingerprints
  for (const k of FINGERPRINT_SCALES) {
    const at = locateIn(capture, resize(latest.strip, k), RESIZED_MATCH)
    if (at) return moved(scaled(latest.header, k), at.x, at.y)
  }
  return null
}

/** Whether a capture shows a saved fingerprint, by pixels alone: no OCR, about half a second. */
export function showsCurrencyWindow(img: Rgba, fingerprints: readonly Fingerprint[]): boolean {
  return locateHeader(img, fingerprints) !== null
}

function scaled(h: Header, k: number): Header {
  const box = (b: Box): Box => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k })
  return { name: box(h.name), expansion: box(h.expansion), quantity: box(h.quantity) }
}

function moved(h: Header, dx: number, dy: number): Header {
  const box = (b: Box): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy })
  return { name: box(h.name), expansion: box(h.expansion), quantity: box(h.quantity) }
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
async function readQuantities(
  workers: Workers,
  cells: readonly Rgba[],
  pitch: number
): Promise<(string | null)[]> {
  // DIGIT_VOTES' upscales are measured at row pitches up to DIGIT_PITCH; a larger UI (bigger
  // screen or UI scale) gets proportionally less, so every vote sees the same on-image digit size.
  const k = Math.min(1, DIGIT_PITCH / pitch)
  const params = { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789' }
  await Promise.all(workers.map((w) => w.setParameters(params)))
  const out: (string | null)[] = []
  let next = 0
  await Promise.all(
    workers.map(async (w) => {
      for (let i = next++; i < cells.length; i = next++) out[i] = await readCell(w, cells[i], k)
    })
  )
  // Cells OCR could not settle are read by the digits the settled ones show (glyphs.ts).
  if (out.every((q) => q !== null)) return out
  const templates = learnDigits(cells.flatMap((cell, i) => (out[i] === null ? [] : [{ cell, text: out[i] }])))
  return out.map((q, i) => q ?? readByGlyphs(cells[i], templates))
}

/**
 * Reads with fewer digits than the cell has glyphs are discarded (OCR drops a "1" of "11"; the
 * glyphs are separate blobs, so their number is known; blur can merge two, never split one).
 * Two surviving reads agreeing settle the cell; otherwise the next setting is tried.
 */
async function readCell(worker: Worker, cell: Rgba, k: number): Promise<string | null> {
  const digits = glyphCount(cell)
  const reads: string[] = []
  for (const v of DIGIT_VOTES) {
    const img = binarizeForOcr(v.flatten ? flattenRows(cell) : cell, v.scale * k, v.threshold)
    const read = (await recognizeCrop(worker, img)).map((l) => l.text.trim()).join('')
    if (read.length >= digits) reads.push(read)
    if (reads.length >= 2 && agreed(reads) !== null) break
  }
  return agreed(reads)
}

/**
 * Separate ink blobs that reach the cell's middle band: one per drawn digit. Blobs are traced over
 * the whole cell, so a "0" whose sides the band sees apart stays one glyph by its top and bottom.
 */
function glyphCount(cell: Rgba): number {
  const flat = flattenRows(cell)
  const { width, height } = flat
  const band0 = Math.floor(height / 4)
  const band1 = Math.ceil((height * 3) / 4)
  // 1 = background or already part of a counted blob.
  const seen = new Uint8Array(width * height)
  for (let i = 0; i < seen.length; i++) if (flat.data[i * 4] <= GLYPH_INK) seen[i] = 1
  let count = 0
  for (let i = band0 * width; i < band1 * width; i++) {
    if (seen[i]) continue
    count++
    fillBlob(seen, width, i)
  }
  return count
}

/** Marks the 8-connected unseen pixels joined to `start` as seen. */
function fillBlob(seen: Uint8Array, width: number, start: number): void {
  const height = seen.length / width
  const stack = [start]
  seen[start] = 1
  for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
    const x = i % width
    const y = (i - x) / width
    for (let n = 0; n < 9; n++) {
      const nx = x + (n % 3) - 1
      const ny = y + Math.floor(n / 3) - 1
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[ny * width + nx]) continue
      seen[ny * width + nx] = 1
      stack.push(ny * width + nx)
    }
  }
}

// tesseract.js 6+ returns only the block tree, and only when asked for it; flatten it to lines.
async function recognizeCrop(worker: Worker, img: Rgba): Promise<Line[]> {
  const { blocks } = (await worker.recognize(encodePng(img), {}, { blocks: true })).data
  return (blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
}

/**
 * `Name`, `Expansion`, `Quantity` left to right at one height, in COLUMNS: each label at least
 * three text heights clear of the previous one. The same three words in running text (this app's
 * own "(Name / Expansion / Quantity)" message once matched) are not a header.
 */
export function findHeader(words: readonly Pick<Word, 'text' | 'bbox'>[]): Header | null {
  const labelled = (label: string): Box[] =>
    words.filter((w) => w.text.replace(/[^A-Za-z]/g, '').toLowerCase() === label).map((w) => w.bbox)
  for (const name of labelled('name')) {
    const h = name.y1 - name.y0
    const level = (b: Box): boolean => Math.abs(b.y0 + b.y1 - name.y0 - name.y1) / 2 < h
    const expansion = labelled('expansion').find((b) => level(b) && b.x0 - name.x1 >= 3 * h)
    const quantity = labelled('quantity').find(
      (b) => level(b) && expansion !== undefined && b.x0 - expansion.x1 >= 3 * h
    )
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

/** Median gap between consecutive name rows, or null with fewer than two rows. */
function rowPitch(names: readonly TextLine[]): number | null {
  if (names.length < 2) return null
  const gaps = names.slice(1).map((n, i) => n.yMid - names[i].yMid).sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}

/** The number every non-empty read agrees on; null when none read or two disagree. */
function agreed(reads: readonly string[]): string | null {
  const numbers = new Set(reads.filter((r) => r !== ''))
  const [only] = numbers
  return numbers.size === 1 && /^\d+$/.test(only) ? only : null
}

/** Every row but an untracked currency's lands in `counts` or, verbatim, in `unmatched`. */
function resolveRows(rows: readonly Row[]): { counts: Record<string, number>; unmatched: string[] } {
  const vocab = currencyVocabulary()
  const counts: Record<string, number> = {}
  const unmatched: string[] = []
  for (const row of rows) {
    if (isUntrackedCurrency(row.name)) continue
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

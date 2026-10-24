// Reads the EverQuest Legends "currencies" inventory window out of a screenshot.
//
// Pipeline: locate the `Name | Expansion | Quantity` header anywhere in the image (absent →
// not-currency-window), OCR the name column raw and the quantity column binarized + digits-only,
// pair the two by row y, then resolve names against the closed currency vocabulary.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createWorker, OEM, PSM, type Line, type Word, type Worker } from 'tesseract.js'
import { decodePng, encodePng, type Rgba } from './png'
import { binarizeForOcr, flattenRows, crop, type Rect } from './raster'
import { currencyVocabulary, matchCurrencyName } from './vocabulary'
import { locateFingerprint } from './locate'

/** `fingerprint` is the header strip as this capture drew it — pass it to the next scan. */
export type CurrencyScan =
  | { counts: Record<string, number>; unmatched: string[]; fingerprint: Rgba }
  | { error: 'not-currency-window' }

/**
 * Each quantity cell is read alone (PSM single line, digits only) under several upscale/threshold
 * settings; the number every non-empty read agrees on wins, any disagreement leaves it unmatched. One setting cannot read both
 * plain rows and the selected row's light band: tiny "11"s collapse to "1" at the edges.
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

interface Header {
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
 * `langDir` holds `eng.traineddata` (see `findOcrLangDir`). Every row the window shows lands in
 * `counts` or, when its name or quantity can't be resolved, verbatim in `unmatched`.
 */
export async function readCurrencyWindow(png: Buffer, langDir: string, fingerprint?: Rgba): Promise<CurrencyScan> {
  const img = decodePng(png)
  // One tesseract worker (a worker_thread under Node) per scan, always terminated.
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    // Read-only cache read of `<langDir>/eng.traineddata`: no download, no cache writes.
    // langPath is set too so a miss can never fall back to the default CDN URL.
    cachePath: langDir,
    cacheMethod: 'readOnly',
    langPath: langDir,
    gzip: false
  })
  try {
    // A remembered header strip found by pixels skips OCR-searching the whole capture (~20 s at
    // 2560x1600): only the window around it is read. No match → the full search.
    const at = fingerprint && locateFingerprint(img, fingerprint)
    if (fingerprint && at) {
      const region: Rect = {
        x: at.x - fingerprint.width * 0.3,
        y: at.y - fingerprint.height,
        width: fingerprint.width * 1.6,
        height: fingerprint.height * 45
      }
      const r = await scan(worker, crop(img, region))
      if (!('error' in r)) return r
    }
    return await scan(worker, img)
  } finally {
    await worker.terminate()
  }
}

async function scan(worker: Worker, img: Rgba): Promise<CurrencyScan> {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  const header = findHeader((await worker.recognize(encodePng(img))).data.words)
  if (header === null) return { error: 'not-currency-window' }

  const textHeight = header.name.y1 - header.name.y0
  const top = header.quantity.y1 + 1
  const nameRect: Rect = {
    x: header.name.x0 - 2 * textHeight,
    y: top,
    width: header.expansion.x0 - 2 - (header.name.x0 - 2 * textHeight),
    height: img.height - top
  }
  const qtyX = (header.expansion.x1 + header.quantity.x0) / 2
  const qtyRect: Rect = { x: qtyX, y: top, width: header.quantity.x1 + textHeight - qtyX, height: img.height - top }

  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '' })
  // Plain and row-flattened name passes: each misses rows the other reads (the selected row's
  // band; the last row of a short window). Per row height, the first line naming an item wins.
  const raw = textLines(await recognizeCrop(worker, crop(img, nameRect)), nameRect, 1)
  const flat = textLines(await recognizeCrop(worker, flattenRows(crop(img, nameRect))), nameRect, 1)
  const names = rowBlock(mergeRows([...raw, ...flat], textHeight), textHeight)

  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789' })
  const rows: Row[] = []
  for (const name of names) {
    const cell: Rect = { x: qtyX, y: name.yMid - 0.75 * textHeight, width: qtyRect.width, height: 1.5 * textHeight }
    const reads: string[] = []
    for (const v of DIGIT_VOTES) {
      const src = crop(img, cell)
      const lines = await recognizeCrop(worker, binarizeForOcr(v.flatten ? flattenRows(src) : src, v.scale, v.threshold))
      reads.push(lines.map((l) => l.text.trim()).join(''))
      // Two settings already agreeing settles the row; the rest only matter on a split.
      if (reads.length === 2 && reads[0] !== '' && reads[0] === reads[1]) break
    }
    rows.push({ name: name.text, qty: agreed(reads) })
  }
  const strip: Rect = {
    x: header.name.x0 - 4,
    y: header.name.y0 - 3,
    width: header.quantity.x1 - header.name.x0 + 8,
    height: textHeight + 6
  }
  return { ...resolveRows(rows), fingerprint: crop(img, strip) }
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

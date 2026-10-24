// Reads the EverQuest Legends "currencies" inventory window out of a screenshot.
//
// Pipeline: locate the `Name | Expansion | Quantity` header anywhere in the image (absent →
// not-currency-window), OCR the name column raw and the quantity column binarized + digits-only,
// pair the two by row y, then resolve names against the closed currency vocabulary.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createWorker, OEM, PSM, type Line, type Word, type Worker } from 'tesseract.js'
import { decodePng, encodePng, type Rgba } from './png'
import { binarizeForOcr, crop, type Rect } from './raster'
import { currencyVocabulary, matchCurrencyName } from './vocabulary'

export type CurrencyScan =
  | { counts: Record<string, number>; unmatched: string[] }
  | { error: 'not-currency-window' }

/** Digits are upscaled and binarized before OCR; at 1x "11" reads as "1". Measured on the
 *  fixture: scale 2-4 x threshold 90-120 all read 24/24 except the corners; this is the middle. */
const DIGIT_SCALE = 3
const DIGIT_THRESHOLD = 105

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
export async function readCurrencyWindow(png: Buffer, langDir: string): Promise<CurrencyScan> {
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
  const names = rowBlock(textLines(await recognizeCrop(worker, crop(img, nameRect)), nameRect, 1), textHeight)

  await worker.setParameters({ tessedit_char_whitelist: '0123456789' })
  const digitImg = binarizeForOcr(crop(img, qtyRect), DIGIT_SCALE, DIGIT_THRESHOLD)
  const qtys = textLines(await recognizeCrop(worker, digitImg), qtyRect, DIGIT_SCALE)

  return pairRows(names, qtys, textHeight)
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

/** Names and quantities joined by row y; anything that doesn't resolve is kept verbatim. */
function pairRows(names: readonly TextLine[], qtys: readonly TextLine[], textHeight: number): CurrencyScan {
  const vocab = currencyVocabulary()
  const counts: Record<string, number> = {}
  const unmatched: string[] = []
  const unpaired = new Set(qtys)
  for (const row of names) {
    const qtyLine = [...unpaired].find((q) => Math.abs(q.yMid - row.yMid) < textHeight * 0.75)
    if (qtyLine) unpaired.delete(qtyLine)
    const qty = qtyLine?.text ?? ''
    const name = matchCurrencyName(row.text, vocab)
    if (name !== null && /^\d+$/.test(qty) && !(name in counts)) counts[name] = Number(qty)
    else unmatched.push(`${row.text} | ${qty}`)
  }
  const bottom = (names.at(-1)?.yMid ?? 0) + textHeight
  for (const q of unpaired) if (q.yMid < bottom) unmatched.push(` | ${q.text}`)
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

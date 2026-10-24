// glyphs.ts — read a quantity cell by matching its digit glyphs against digits learned from the
// same capture. The game draws every digit with one fixed bitmap font, so the cells OCR already
// agreed on show exactly what each digit looks like at this capture's size and contrast. A cell OCR
// cannot settle (a 6 read as 5 on the selected row's light band) is read glyph by glyph.

import type { Rgba } from './png'
import { flattenRows, type Rect } from './raster'

/** Ink above this (after row flattening) is part of a glyph. */
const GLYPH_INK = 60
/** Mask ink: brighter than this share of the glyph's own brightest pixel. */
const MASK_LEVEL = 0.45
/** A glyph is accepted only with this overlap, and clearly ahead of every other digit. */
const MIN_SCORE = 0.75
const MIN_MARGIN = 0.1

/** Column runs of ink in the cell's middle band, each cut to its own ink rows. */
export function segmentGlyphs(cell: Rgba): Rgba[] {
  const flat = flattenRows(cell)
  const ink = (x: number, y: number): boolean => flat.data[(y * flat.width + x) * 4] > GLYPH_INK
  const band0 = Math.floor(cell.height / 4)
  const band1 = Math.ceil((cell.height * 3) / 4)
  const inkColumn = (x: number): boolean => {
    for (let y = band0; y < band1; y++) if (ink(x, y)) return true
    return false
  }
  const runs: [number, number][] = []
  for (let x = 0; x < flat.width; x++) {
    if (!inkColumn(x)) continue
    const last = runs.at(-1)
    if (last?.[1] === x - 1) last[1] = x
    else runs.push([x, x])
  }
  return runs.map(([x0, x1]) => {
    let y0 = flat.height
    let y1 = -1
    for (let y = 0; y < flat.height; y++) {
      for (let x = x0; x <= x1; x++) {
        if (ink(x, y)) {
          y0 = Math.min(y0, y)
          y1 = Math.max(y1, y)
        }
      }
    }
    return cut(flat, { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
  })
}

function cut(img: Rgba, { x, y, width, height }: Rect): Rgba {
  const data = new Uint8Array(width * height * 4)
  for (let r = 0; r < height; r++) data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + width) * 4), r * width * 4)
  return { width, height, data }
}

/** A glyph as an ink mask relative to its own brightest pixel (the selected row's band only
 *  lowers contrast, not shape). Templates and target come from one capture, so sizes match. */
interface Mask {
  readonly width: number
  readonly height: number
  readonly on: Uint8Array
}

function mask(glyph: Rgba): Mask {
  let max = 0
  for (let i = 0; i < glyph.width * glyph.height; i++) max = Math.max(max, glyph.data[i * 4])
  const on = new Uint8Array(glyph.width * glyph.height)
  for (let i = 0; i < on.length; i++) on[i] = glyph.data[i * 4] > MASK_LEVEL * max ? 1 : 0
  return { width: glyph.width, height: glyph.height, on }
}

/** Overlap (intersection over union) of two masks aligned bottom-right, like right-aligned digits. */
function overlap(a: Mask, b: Mask): number {
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const at = (m: Mask, x: number, y: number): number => {
    const mx = x - (width - m.width)
    const my = y - (height - m.height)
    return mx >= 0 && my >= 0 ? m.on[my * m.width + mx] : 0
  }
  let both = 0
  let either = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(a, x, y)
      const q = at(b, x, y)
      both += p & q
      either += p | q
    }
  }
  return either === 0 ? 0 : both / either
}

export type DigitTemplates = Map<string, Mask[]>

/** Digit images from cells whose number is known and whose glyph count matches its digits. */
export function learnDigits(samples: readonly { cell: Rgba; text: string }[]): DigitTemplates {
  const templates: DigitTemplates = new Map()
  for (const { cell, text } of samples) {
    const glyphs = segmentGlyphs(cell)
    if (glyphs.length !== text.length) continue
    glyphs.forEach((g, i) => templates.set(text[i], [...(templates.get(text[i]) ?? []), mask(g)]))
  }
  return templates
}

/** The cell's number by glyph matching, or null when any glyph is not a clear match. */
export function readByGlyphs(cell: Rgba, templates: DigitTemplates): string | null {
  const glyphs = segmentGlyphs(cell)
  if (glyphs.length === 0 || templates.size === 0) return null
  let out = ''
  for (const glyph of glyphs) {
    const g = mask(glyph)
    const scores = [...templates].map(([digit, ts]) => ({ digit, score: Math.max(...ts.map((t) => overlap(g, t))) }))
    scores.sort((a, b) => b.score - a.score)
    const [first, second] = scores
    if (first.score < MIN_SCORE || (second && first.score - second.score < MIN_MARGIN)) return null
    out += first.digit
  }
  return out
}

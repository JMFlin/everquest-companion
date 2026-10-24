// locate.ts — find a remembered fingerprint (the header strip of the currency window, cut from
// an earlier successful scan) in a new capture, without OCR. Normalized cross-correlation, coarse
// on a 4x box-downsampled image, then refined at full resolution around the best coarse hit.

import type { Rgba } from './png'

const COARSE = 4
/** NCC at or above this is the same strip; text on a dark textured background scores ~0.95+. */
const MATCH = 0.85

interface Grey {
  readonly width: number
  readonly height: number
  readonly v: Float32Array
}

function grey(img: Rgba): Grey {
  const v = new Float32Array(img.width * img.height)
  for (let i = 0; i < v.length; i++) {
    v[i] = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]
  }
  return { width: img.width, height: img.height, v }
}

/** Mean of the f×f block whose top-left is (x·f, y·f). */
function blockMean(g: Grey, f: number, x: number, y: number): number {
  let s = 0
  for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += g.v[(y * f + dy) * g.width + x * f + dx]
  return s / (f * f)
}

function shrink(g: Grey, f: number): Grey {
  const width = Math.floor(g.width / f)
  const height = Math.floor(g.height / f)
  const v = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) v[y * width + x] = blockMean(g, f, x, y)
  return { width, height, v }
}

/** A template with its mean and centred sum of squares precomputed. */
interface Template {
  readonly g: Grey
  readonly mean: number
  readonly norm: number
}

function template(g: Grey): Template {
  let s = 0
  for (const a of g.v) s += a
  const mean = s / g.v.length
  let norm = 0
  for (const a of g.v) norm += (a - mean) ** 2
  return { g, mean, norm }
}

/** NCC of `t` placed at (x, y) in `g`; -1 when the window is flat. */
function ncc(g: Grey, t: Template, x: number, y: number): number {
  let sum = 0
  let sumSq = 0
  let cross = 0
  for (let ty = 0; ty < t.g.height; ty++) {
    const row = (y + ty) * g.width + x
    for (let tx = 0; tx < t.g.width; tx++) {
      const a = g.v[row + tx]
      sum += a
      sumSq += a * a
      cross += a * (t.g.v[ty * t.g.width + tx] - t.mean)
    }
  }
  const variance = sumSq - (sum * sum) / t.g.v.length
  return variance <= 0 || t.norm === 0 ? -1 : cross / Math.sqrt(variance * t.norm)
}

interface Span {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

/** Best placement of `t` with its top-left inside `span` (clamped to the image), with its score. */
function best(g: Grey, t: Template, span: Span): { x: number; y: number; score: number } {
  let hit = { x: -1, y: -1, score: -1 }
  for (let y = Math.max(0, span.y0); y <= Math.min(g.height - t.g.height, span.y1); y++) {
    for (let x = Math.max(0, span.x0); x <= Math.min(g.width - t.g.width, span.x1); x++) {
      const score = ncc(g, t, x, y)
      if (score > hit.score) hit = { x, y, score }
    }
  }
  return hit
}

/** Top-left of `fingerprint` in `img`, or null when nothing matches well enough. */
export function locateFingerprint(img: Rgba, fingerprint: Rgba): { x: number; y: number } | null {
  if (fingerprint.width > img.width || fingerprint.height > img.height) return null
  const g = grey(img)
  const t = grey(fingerprint)
  const cg = shrink(g, COARSE)
  const ct = shrink(t, COARSE)
  if (ct.width < 4 || ct.height < 2) return null
  const coarse = best(cg, template(ct), { x0: 0, x1: cg.width, y0: 0, y1: cg.height })
  if (coarse.x < 0) return null
  const fine = best(g, template(t), {
    x0: (coarse.x - 1) * COARSE,
    x1: (coarse.x + 1) * COARSE,
    y0: (coarse.y - 1) * COARSE,
    y1: (coarse.y + 1) * COARSE
  })
  return fine.score >= MATCH ? { x: fine.x, y: fine.y } : null
}

// Pixel operations on decoded RGBA, in pure TS.

import type { Rgba } from './png'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** `rect` clamped to the image. */
export function crop(img: Rgba, rect: Rect): Rgba {
  const x0 = Math.max(0, Math.round(rect.x))
  const y0 = Math.max(0, Math.round(rect.y))
  const x1 = Math.min(img.width, Math.round(rect.x + rect.width))
  const y1 = Math.min(img.height, Math.round(rect.y + rect.height))
  const width = Math.max(0, x1 - x0)
  const height = Math.max(0, y1 - y0)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * img.width + x0) * 4
    data.set(img.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { width, height, data }
}

/**
 * Light-on-dark text → black-on-white binary, upscaled `scale`x (bilinear).
 * Alpha is flattened onto black first; luma above `threshold` is ink.
 */
export function binarizeForOcr(img: Rgba, scale: number, threshold: number): Rgba {
  const grey = new Float32Array(img.width * img.height)
  for (let i = 0; i < grey.length; i++) {
    const a = img.data[i * 4 + 3] / 255
    grey[i] = a * (0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2])
  }
  const width = img.width * scale
  const height = img.height * scale
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.max(0, (y + 0.5) / scale - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(img.height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, (x + 0.5) / scale - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(img.width - 1, x0 + 1)
      const fx = sx - x0
      const top = grey[y0 * img.width + x0] * (1 - fx) + grey[y0 * img.width + x1] * fx
      const bottom = grey[y1 * img.width + x0] * (1 - fx) + grey[y1 * img.width + x1] * fx
      const v = top * (1 - fy) + bottom * fy > threshold ? 0 : 255
      const o = (y * width + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }
  }
  return { width, height, data }
}

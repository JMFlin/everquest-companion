// Pure-TS PNG codec over node:zlib, so the scan needs no native image library.
// Decode: 8-bit RGB/RGBA (colour types 2/6), non-interlaced, all five filter types.
// Encode: RGBA, filter 0 on every row.

import { crc32, deflateSync, inflateSync } from 'node:zlib'

/** Row-major RGBA, 4 bytes per pixel. */
export interface Rgba {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function decodePng(png: Buffer): Rgba {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('png: bad signature')
  const { width, height, channels, idat } = readChunks(png)
  const raw = inflateSync(idat)
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      cur[i] = (line[i] + predict(filter, a, b, c)) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = cur[x * channels]
      out[o + 1] = cur[x * channels + 1]
      out[o + 2] = cur[x * channels + 2]
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 255
    }
    prev = cur
  }
  return { width, height, data: out }
}

function readChunks(png: Buffer): { width: number; height: number; channels: number; idat: Buffer } {
  let header: Buffer | null = null
  const idat: Buffer[] = []
  for (let off = 8; off < png.length; off += 12 + png.readUInt32BE(off)) {
    const type = png.toString('latin1', off + 4, off + 8)
    const body = png.subarray(off + 8, off + 8 + png.readUInt32BE(off))
    if (type === 'IHDR') header = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
  }
  if (header === null) throw new Error('png: missing IHDR')
  const [depth, colour, , , interlace] = header.subarray(8, 13)
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error(`png: unsupported depth=${depth} colour=${colour} interlace=${interlace}`)
  }
  return {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    channels: colour === 6 ? 4 : 3,
    idat: Buffer.concat(idat)
  }
}

function predict(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 0: return 0
    case 1: return a
    case 2: return b
    case 3: return (a + b) >> 1
    case 4: {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    default: throw new Error(`png: bad filter type ${filter}`)
  }
}

export function encodePng(img: Rgba): Buffer {
  const stride = img.width * 4
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

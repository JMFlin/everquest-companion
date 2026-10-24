// printWindowWorker.ts — the EverQuest window drawn by PrintWindow, as a PNG, posted once.
// A worker because main never loads koffi (presenceNative.ts): a native failure stays here.
// PW_RENDERFULLCONTENT asks DWM for the window's own surface, so other windows covering it do not
// matter; a minimized window has no surface and is reported as such.

import { parentPort } from 'node:worker_threads'
import * as koffi from 'koffi'
import { encodePng } from './currencyScan/png'

export type PrintWindowMessage =
  | { ok: true; png: Uint8Array }
  | { ok: false; reason: 'not-found' | 'minimized' | 'failed' }

const EQ_TITLE = 'EverQuest'
const PW_RENDERFULLCONTENT = 2
const BITMAPINFO_BYTES = 44
const TITLE_CHARS = 256

type Win32Fn = (...args: unknown[]) => unknown

/** Walk top-level windows (no callback needed) for the first visible one titled EverQuest*. */
function findEqWindow(FindWindowExW: Win32Fn, GetWindowTextW: Win32Fn, IsWindowVisible: Win32Fn): unknown {
  const title = Buffer.alloc(TITLE_CHARS * 2)
  for (let w = FindWindowExW(null, null, null, null); w !== null; w = FindWindowExW(null, w, null, null)) {
    const n = Number(GetWindowTextW(w, title, TITLE_CHARS))
    if (n > 0 && title.toString('utf16le', 0, n * 2).startsWith(EQ_TITLE) && IsWindowVisible(w) === true) return w
  }
  return null
}

function capture(): PrintWindowMessage {
  const user32 = koffi.load('user32.dll')
  const gdi32 = koffi.load('gdi32.dll')
  const bind = (lib: koffi.IKoffiLib, prototype: string): Win32Fn => lib.func(prototype) as Win32Fn

  const FindWindowExW = bind(user32, 'void *__stdcall FindWindowExW(void *parent, void *after, void *cls, void *title)')
  const GetWindowTextW = bind(user32, 'int __stdcall GetWindowTextW(void *hWnd, _Out_ void *buf, int max)')
  const IsWindowVisible = bind(user32, 'bool __stdcall IsWindowVisible(void *hWnd)')
  const IsIconic = bind(user32, 'bool __stdcall IsIconic(void *hWnd)')
  const GetWindowRect = bind(user32, 'bool __stdcall GetWindowRect(void *hWnd, _Out_ void *rect)')
  const GetDC = bind(user32, 'void *__stdcall GetDC(void *hWnd)')
  const ReleaseDC = bind(user32, 'int __stdcall ReleaseDC(void *hWnd, void *hdc)')
  const PrintWindow = bind(user32, 'bool __stdcall PrintWindow(void *hWnd, void *hdc, uint32 flags)')
  const CreateCompatibleDC = bind(gdi32, 'void *__stdcall CreateCompatibleDC(void *hdc)')
  const CreateCompatibleBitmap = bind(gdi32, 'void *__stdcall CreateCompatibleBitmap(void *hdc, int w, int h)')
  const SelectObject = bind(gdi32, 'void *__stdcall SelectObject(void *hdc, void *obj)')
  const GetDIBits = bind(
    gdi32,
    'int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 lines, _Out_ void *bits, _Inout_ void *bmi, uint32 usage)'
  )
  const DeleteObject = bind(gdi32, 'bool __stdcall DeleteObject(void *obj)')
  const DeleteDC = bind(gdi32, 'bool __stdcall DeleteDC(void *hdc)')

  const hwnd = findEqWindow(FindWindowExW, GetWindowTextW, IsWindowVisible)
  if (hwnd === null) return { ok: false, reason: 'not-found' }
  if (IsIconic(hwnd) === true) return { ok: false, reason: 'minimized' }

  const rect = Buffer.alloc(16)
  if (GetWindowRect(hwnd, rect) !== true) return { ok: false, reason: 'failed' }
  const width = rect.readInt32LE(8) - rect.readInt32LE(0)
  const height = rect.readInt32LE(12) - rect.readInt32LE(4)
  if (width <= 0 || height <= 0) return { ok: false, reason: 'failed' }

  const screenDc = GetDC(null)
  const memDc = CreateCompatibleDC(screenDc)
  const bitmap = CreateCompatibleBitmap(screenDc, width, height)
  const old = SelectObject(memDc, bitmap)
  try {
    if (PrintWindow(hwnd, memDc, PW_RENDERFULLCONTENT) !== true) return { ok: false, reason: 'failed' }
    // 32-bit top-down BI_RGB: rows come out BGRA, first row first.
    const bmi = Buffer.alloc(BITMAPINFO_BYTES)
    bmi.writeUInt32LE(40, 0)
    bmi.writeInt32LE(width, 4)
    bmi.writeInt32LE(-height, 8)
    bmi.writeUInt16LE(1, 12)
    bmi.writeUInt16LE(32, 14)
    const bgra = Buffer.alloc(width * height * 4)
    SelectObject(memDc, old)
    if (Number(GetDIBits(memDc, bitmap, 0, height, bgra, bmi, 0)) !== height) return { ok: false, reason: 'failed' }
    const data = new Uint8Array(bgra.length)
    for (let i = 0; i < bgra.length; i += 4) {
      data[i] = bgra[i + 2]
      data[i + 1] = bgra[i + 1]
      data[i + 2] = bgra[i]
      data[i + 3] = 255
    }
    return { ok: true, png: encodePng({ width, height, data }) }
  } finally {
    SelectObject(memDc, old)
    DeleteObject(bitmap)
    DeleteDC(memDc)
    ReleaseDC(null, screenDc)
  }
}

let result: PrintWindowMessage
try {
  result = capture()
} catch {
  result = { ok: false, reason: 'failed' }
}
parentPort?.postMessage(result)

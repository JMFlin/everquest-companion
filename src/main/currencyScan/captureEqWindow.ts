// captureEqWindow.ts — images that may hold the EverQuest currency window, best first.
// 1. PrintWindow on the game window (printWindowWorker): works while other windows cover it.
// 2. desktopCapturer's window source, when Chromium lists it (it often doesn't for DirectX games).
// 3. Every screen. The reader's header fingerprint picks whichever image holds the list.

import { desktopCapturer, screen } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { PrintWindowMessage } from '../printWindowWorker'

const EQ_WINDOW = 'EverQuest'

function printEqWindow(): Promise<PrintWindowMessage> {
  return new Promise((resolve) => {
    const w = new Worker(join(__dirname, 'printWindowWorker.js'))
    w.once('message', (m: PrintWindowMessage) => resolve(m))
    w.once('error', () => resolve({ ok: false, reason: 'failed' }))
    w.once('exit', () => resolve({ ok: false, reason: 'failed' }))
  })
}

export async function captureEqImages(): Promise<Buffer[]> {
  const printed = await printEqWindow()
  // One thumbnail box for all sources: the largest display at native pixels, so nothing scales up.
  let width = 0
  let height = 0
  for (const d of screen.getAllDisplays()) {
    width = Math.max(width, Math.round(d.size.width * d.scaleFactor))
    height = Math.max(height, Math.round(d.size.height * d.scaleFactor))
  }
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width, height }
  })
  const eq = sources.filter((s) => s.id.startsWith('window:') && s.name.startsWith(EQ_WINDOW))
  const screens = sources.filter((s) => s.id.startsWith('screen:'))
  return [
    ...(printed.ok ? [Buffer.from(printed.png)] : []),
    ...[...eq, ...screens].filter((s) => !s.thumbnail.isEmpty()).map((s) => s.thumbnail.toPNG())
  ]
}

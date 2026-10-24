// captureEqWindow.ts — images that may hold the EverQuest currency window, best first.
// Window capture reads the game's own surface, so overlays drawn above it never reach the image.
// Chromium does not list every DirectX game window (eqgame's maximized window is missing), so the
// fallback is every screen; the reader's header fingerprint picks the one with the list.

import { desktopCapturer, screen } from 'electron'

const EQ_WINDOW = 'EverQuest'

export async function captureEqImages(): Promise<Buffer[]> {
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
  return [...eq, ...screens].filter((s) => !s.thumbnail.isEmpty()).map((s) => s.thumbnail.toPNG())
}

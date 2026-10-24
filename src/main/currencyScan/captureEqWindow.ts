// captureEqWindow.ts — the EverQuest window as a PNG, or null when no such window is open.
// Window capture reads the game's own surface, so overlays drawn above it never reach the image.
// The thumbnail box is the source's display size: desktopCapturer scales into it, never up.

import { desktopCapturer, screen } from 'electron'

const EQ_WINDOW = 'EverQuest'

export async function captureEqWindow(): Promise<Buffer | null> {
  const { width, height } = screen.getPrimaryDisplay().size
  const scale = screen.getPrimaryDisplay().scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
  })
  const eq = sources.find((s) => s.name.startsWith(EQ_WINDOW))
  if (!eq || eq.thumbnail.isEmpty()) return null
  return eq.thumbnail.toPNG()
}

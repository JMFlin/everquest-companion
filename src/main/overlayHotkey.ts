// ============================================================================
// overlayHotkey.ts — ONE KEY THAT CLEARS EVERY OVERLAY OFF THE SCREEN, AND PUTS THEM BACK.
// ============================================================================
//
// Alt+Shift+0 is the app's single global shortcut, an owner decision that relaxes the earlier
// "no global input while EverQuest is foreground" rule for this one key. The key exists precisely
// to be pressed in-game, so a focus-gated listener (the appBack.ts shape) could not serve it.
//
// A press with ANY overlay open closes them all and remembers which; a press with none open
// reopens what the last press closed. Closing goes through `setOverlayOpen`, the same path as the
// TitleBar menu, so the persisted open-state and the menu stay truthful throughout.
//
// The toggle is a function of its two dependencies — Electron-free, so it is a node test.

import type { OverlayKind } from '../shared/types'

export const OVERLAY_HOTKEY = 'Alt+Shift+0'

export interface OverlayToggleDeps {
  openKinds: () => OverlayKind[]
  setOpen: (kind: OverlayKind, open: boolean) => void
}

export function createOverlayToggle(deps: OverlayToggleDeps): () => void {
  let closedByHotkey: OverlayKind[] = []
  return () => {
    const open = deps.openKinds()
    if (open.length > 0) {
      closedByHotkey = open
      for (const kind of open) deps.setOpen(kind, false)
    } else {
      for (const kind of closedByHotkey) deps.setOpen(kind, true)
      closedByHotkey = []
    }
  }
}

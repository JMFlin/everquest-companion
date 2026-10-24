// overlayCollapse.ts — roll a panel overlay up to its title bar and back down.
//
// A real minimize is not an option: overlays skip the taskbar, so a minimized one would have no
// button to come back from. Collapsing keeps the title bar (and its pin / collapse / close) on
// screen and drops the rest. The height to return to is remembered in the store, because the
// window's own bounds are re-persisted whenever it is moved — collapsed height included.

import type { BrowserWindow } from 'electron'
import type { OverlayKind } from '../shared/types'
import { OVERLAY_MIN_SIZE, isStripKind } from './overlayLayout'
import { applyOverlayBounds } from './overlayBounds'
import { getOverlayConfig, setOverlayConfig } from './store'

/** The title-bar row ends 36 px from the top (overlayHotZone.ts CHROME_STRIP_PX's measure) + 1 border. */
const COLLAPSED_HEIGHT = 37

/** Collapse or expand `kind`'s live window and remember the choice. Strips have no title bar. */
export function setOverlayCollapsed(kind: OverlayKind, w: BrowserWindow, collapsed: boolean): void {
  if (isStripKind(kind) || w.isDestroyed()) return
  const b = w.getBounds()
  if (collapsed) {
    const expandedHeight = getOverlayConfig(kind).collapsed ? getOverlayConfig(kind).expandedHeight : b.height
    setOverlayConfig(kind, { collapsed: true, expandedHeight })
    w.setMinimumSize(OVERLAY_MIN_SIZE.width, COLLAPSED_HEIGHT)
    applyOverlayBounds(kind, { ...b, height: COLLAPSED_HEIGHT })
  } else {
    const height = getOverlayConfig(kind).expandedHeight ?? OVERLAY_MIN_SIZE.height
    setOverlayConfig(kind, { collapsed: false })
    w.setMinimumSize(OVERLAY_MIN_SIZE.width, OVERLAY_MIN_SIZE.height)
    applyOverlayBounds(kind, { ...b, height: Math.max(height, OVERLAY_MIN_SIZE.height) })
  }
}

/** A window that was collapsed when it last closed opens collapsed. */
export function restoreOverlayCollapsed(kind: OverlayKind, w: BrowserWindow): void {
  if (getOverlayConfig(kind).collapsed) setOverlayCollapsed(kind, w, true)
}

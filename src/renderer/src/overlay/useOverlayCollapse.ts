// useOverlayCollapse — this overlay's rolled-up state (main/overlayCollapse.ts owns the resize),
// read from its config so the title-bar button flips with the echo main sends back.

import { useEffect, useState } from 'react'

export function useOverlayCollapse(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    void window.eqOverlay.getConfig().then((c) => setCollapsed(c.collapsed === true))
    return window.eqOverlay.onConfig((c) => setCollapsed(c.collapsed === true))
  }, [])
  return { collapsed, toggle: () => window.eqOverlay.setCollapsed(!collapsed) }
}

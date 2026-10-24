// useAutoRescan — the background-rescan checkbox's state, shared by the Motes tab and the motes
// overlay. Main owns the setting and the timer; both surfaces hear every change, so their
// checkboxes agree and either one shows "counts updated" after a background save.

import { useEffect, useState } from 'react'
import type { AutoRescanState } from '@shared/currencyScan'

type Bridge = Pick<Window['eq'], 'getAutoRescan' | 'setAutoRescan' | 'onAutoRescan'>

export interface AutoRescan {
  enabled: boolean
  setEnabled: (on: boolean) => void
  /** "Counts updated <time>" after a background rescan saved, else null. */
  note: string | null
}

export function useAutoRescan(bridge: Bridge): AutoRescan {
  const [state, setState] = useState<AutoRescanState>({ enabled: false, updatedAt: null })
  useEffect(() => {
    void bridge.getAutoRescan().then(setState)
    return bridge.onAutoRescan(setState)
  }, [bridge])
  return {
    enabled: state.enabled,
    setEnabled: (on) => void bridge.setAutoRescan(on).then(setState),
    note: state.updatedAt === null ? null : `Counts updated ${new Date(state.updatedAt).toLocaleTimeString()}`
  }
}

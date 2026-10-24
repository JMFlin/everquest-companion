// useAutoRescan — the background-rescan checkbox's state, shared by the Motes tab and the motes
// overlay. Main owns the setting and the timer; both surfaces hear every change, so their
// checkboxes agree and either one shows "counts updated" after a background save. While on, the
// state re-renders every second for the countdown to the next rescan.

import { useEffect, useState } from 'react'
import type { AutoRescanState } from '@shared/currencyScan'

type Bridge = Pick<Window['eq'], 'getAutoRescan' | 'setAutoRescan' | 'onAutoRescan'>

export interface AutoRescan {
  enabled: boolean
  setEnabled: (on: boolean) => void
  /** "next in 32 s" while on, else null. */
  countdown: string | null
  /** "Counts updated <time>" after a background rescan saved, else null. */
  note: string | null
}

export function useAutoRescan(bridge: Bridge): AutoRescan {
  const [state, setState] = useState<AutoRescanState>({ enabled: false, updatedAt: null, nextAt: null })
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    void bridge.getAutoRescan().then(setState)
    return bridge.onAutoRescan(setState)
  }, [bridge])
  useEffect(() => {
    if (state.nextAt === null) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [state.nextAt])
  return {
    enabled: state.enabled,
    countdown: state.nextAt === null ? null : `next in ${Math.max(0, Math.ceil((state.nextAt - now) / 1000))} s`,
    setEnabled: (on) => void bridge.setAutoRescan(on).then(setState),
    note: state.updatedAt === null ? null : `Counts updated ${new Date(state.updatedAt).toLocaleTimeString()}`
  }
}

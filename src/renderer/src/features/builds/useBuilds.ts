// useBuilds — the Builds payload and the selected build, for the tab and the overlay alike.
//
// The selection is one localStorage key, so the tab's dropdown and the overlay's (separate windows,
// same origin) stay on the same build: a `storage` event fires in the other window on every change.
// The payload is re-read on mount, on Reload, and whenever a dump is re-read or the character
// changes — the caller passes whichever of those pushes its bridge has.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { compareBuild, type Build, type BuildsPayload, type CompareRow } from '@shared/builds'

const SELECTED_KEY = 'builds.selected'

export interface BuildsBridge {
  getBuilds: () => Promise<BuildsPayload>
  /** pushes after which the payload is stale (dump re-read, character switch) */
  subscribe: (reload: () => void) => () => void
}

export interface BuildsState {
  payload: BuildsPayload | null
  selected: Build | null
  select: (id: string) => void
  reload: () => void
  /** the selected build against the body (every cell differs when there is no dump); null without a build */
  rows: CompareRow[] | null
}

export function useBuilds(bridge: BuildsBridge): BuildsState {
  const [payload, setPayload] = useState<BuildsPayload | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY))
  const { getBuilds, subscribe } = bridge

  const reload = useCallback(() => void getBuilds().then(setPayload), [getBuilds])
  useEffect(() => {
    reload()
    return subscribe(reload)
  }, [reload, subscribe])

  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === SELECTED_KEY) setSelectedId(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const select = useCallback((id: string) => {
    localStorage.setItem(SELECTED_KEY, id)
    setSelectedId(id)
  }, [])

  const selected = payload?.builds.find((b) => b.id === selectedId) ?? payload?.builds[0] ?? null
  const rows = useMemo(
    () => (selected === null ? null : compareBuild(selected, payload?.worn?.cells ?? {})),
    [selected, payload]
  )
  return { payload, selected, select, reload, rows }
}
